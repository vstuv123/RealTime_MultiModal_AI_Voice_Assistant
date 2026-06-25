import os
import json
import time
import asyncio
import base64
from contextlib import asynccontextmanager as _actx  # noqa – not used directly
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from groq import AsyncGroq
from cartesia import AsyncCartesia

from deepgram import AsyncDeepgramClient
from deepgram.listen.v1.types.listen_v1results import ListenV1Results
from deepgram.core.events import EventType
import uuid
from database import RedisVoiceStore, redis_client
from fallbacks import (
    run_with_deepgram_retry,
    whisper_fallback_loop,
    handle_cartesia_failure,
    notify_redis_down,
    notify_redis_recovered,
)

if os.environ.get("ENV") != "production":
    load_dotenv()  # only loads .env file in local dev, ignored in Docker

app = FastAPI(title="Ultra Low-Latency Voice Engine Backend (v7.3.1)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

groq_client = AsyncGroq(api_key=os.environ.get("GROQ_API_KEY"))
deepgram_client = AsyncDeepgramClient(api_key=os.environ.get("DEEPGRAM_API_KEY"))
cartesia_client = AsyncCartesia(api_key=os.environ.get("CARTESIA_API_KEY"))

import re


def clean_for_tts(text: str) -> str:
    text = re.sub(r"```[\s\S]*?```", "", text)  # remove full code blocks
    text = re.sub(r"`[^`]*`", "", text)  # remove inline code
    text = re.sub(r"\*+", "", text)  # remove ** *
    text = re.sub(r"#{1,6}\s?", "", text)  # remove headers
    text = re.sub(r"_{1,2}", "", text)  # remove __ _
    text = re.sub(r"[+\-=|<>{}[\]\\]", "", text)  # remove code symbols
    text = re.sub(r"\s+", " ", text)  # collapse whitespace
    return text.strip()


def is_speakable(text: str) -> bool:
    # must have at least one actual word (2+ letters)
    return bool(re.search(r"[a-zA-Z]{2,}", text))


MATCH_CHARS = 8  # tune this number


def partial_match(a: str, b: str, n: int = MATCH_CHARS) -> bool:
    """Returns True if first n chars of a appear anywhere in b (case-insensitive)"""
    chunk = a.strip()[:n].lower()
    return chunk in b.lower()


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def send_event(
        self,
        websocket: WebSocket,
        event_type: str,
        message: str,
        session_id: str,
        **kwargs,
    ):
        payload = {
            "event_type": event_type,
            "timestamp": int(time.time() * 1000),
            "session_id": session_id,
            "message": message,
            **kwargs,
        }

        try:
            await websocket.send_text(json.dumps(payload))
        except Exception:
            pass


manager = ConnectionManager()
_LOCAL_USER_STORE = {}


# backend/main.py -> Add right above your WebSocket endpoint
# module level in main.py
class DeepgramConnectionError(Exception):
    pass


@app.get("/api/session/{session_id}")
async def check_and_get_session(session_id: str):
    """Checks if a session exists in Redis and returns its historical chats."""
    # Look up session metadata in Redis
    session_key = f"session_meta:{session_id}"

    # Check if the key exists either in physical Redis or our memory fallback dictionary
    exists = False
    user_id = "unknown"

    try:
        exists = await redis_client.exists(session_key)
        if exists:
            meta = await redis_client.hgetall(session_key)
            user_id = meta.get("user_id", "unknown")
    except Exception as e:
        # Just return it in response — frontend handles it
        return {
            "exists": False,
            "messages": [],
            "events": [],
            "redis_error": True,
            "error_message": f"Redis unavailable: {str(e)}",
        }

    if not exists:
        return {"exists": False, "messages": [], "events": []}

    # ── FIXED: FETCH GLOBAL USER PROFILE FROM REDIS ──────────────────────────
    user_key = f"user:{user_id}"
    username = "Operator"
    email = "guest@platform.dev"

    try:
        user_meta = await redis_client.hgetall(user_key)
        if user_meta:
            username = user_meta.get("username", "Operator")
            email = user_meta.get("email", "guest@platform.dev")
    except Exception:
        if user_key in _LOCAL_USER_STORE:
            username = _LOCAL_USER_STORE[user_key].get("username", "Operator")
            email = _LOCAL_USER_STORE[user_key].get("email", "guest@platform.dev")

    # 1. Fetch dialogue text items
    chats = await RedisVoiceStore.get_session_chats(session_id)
    frontend_messages = [
        {
            "id": c.get("id"),
            "role": c.get("role"),
            "text": c.get("text"),
            "isStreaming": False,
        }
        for c in chats
    ]

    # 2. Pull all persistent architectural system steps out of the Redis event array
    db_events = await RedisVoiceStore.get_session_events(session_id)
    frontend_events = []
    for e in db_events:
        # Convert timestamps back into clean string headers matching frontend type models
        time_struct = time.localtime(e.get("timestamp", 0) / 1000)
        formatted_time = time.strftime("%H:%M:%S", time_struct)

        if e.get("event_type") == "first_audio_byte":
            frontend_events.append(
                {
                    "id": e.get("id"),
                    "event_type": e.get("event_type"),
                    "speaker": e.get("speaker") if e.get("speaker") else None,
                    "timestamp": e.get("timestamp"),
                    "session_id": session_id,
                    "formattedTime": formatted_time,
                    "message": e.get("message"),
                    "service": e.get("service") if e.get("service") else "deepgram",
                    "asr_latency": e.get("asr_latency"),
                    "llm_latency": e.get("llm_latency"),
                    "tts_latency": e.get("tts_latency"),
                    "total_latency": e.get("total_latency"),
                }
            )
        else:
            frontend_events.append(
                {
                    "id": e.get("id"),
                    "event_type": e.get("event_type"),
                    "speaker": e.get("speaker") if e.get("speaker") else None,
                    "timestamp": e.get("timestamp"),
                    "session_id": session_id,
                    "formattedTime": formatted_time,
                    "message": e.get("message"),
                }
            )

    return {
        "exists": True,
        "user_id": user_id,
        "username": username,
        "email": email,
        "messages": frontend_messages,
        "events": frontend_events,
    }


@app.websocket("/ws/voice")
async def voice_pipeline_endpoint(websocket: WebSocket):

    await manager.connect(websocket)
    session_id = f"sess_{int(time.time())}"
    # Inside process_text_and_voice, before the LLM stream loop:
    context_id = str(uuid.uuid4())  # fresh every response
    # Extract real-world profile attributes from frontend URL arguments dynamically

    query_params = websocket.query_params
    username = query_params.get("username", "Bilal_Dev")
    user_id = query_params.get("user_id", "usr_fallback_99")
    email = query_params.get("email", "user@gmail.com")
    session_id = query_params.get("session_id", f"sess_{int(time.time())}")

    # Check if this user hash key already exists in your Redis Docker node
    user_exists = False
    try:
        user_exists = await redis_client.exists(f"user:{user_id}")
    except Exception:
        user_exists = f"user:{user_id}" in _LOCAL_USER_STORE

    if not user_exists:
        # Only build a brand new profile record if it's an entirely new registration session!
        await RedisVoiceStore.create_user_profile(user_id, username, email)

    await RedisVoiceStore.initialize_session_meta(session_id, user_id)

    timers = {"asr_start": 0.0, "llm_start": 0.0, "tts_start": 0.0, "total_start": 0.0}
    # ADDED: This memory buffer will hold your whole speech stream across small pauses
    # fix — mutable so nested functions can modify it
    confirmed_buffer = [""]  # access as confirmed_buffer[0]
    last_partial = [""]
    asr_latency_final = [0]  # ✅ store calculated ASR latency here
    asr_first_result = [False]  # ✅ track if first result already captured
    transcript_queue: asyncio.Queue = asyncio.Queue()

    # One buffer for THIS browser WebSocket session only
    recent_audio = bytearray()

    # 2 sec × 16000 samples/sec × 2 bytes/sample × mono
    MAX_RECENT_AUDIO_BYTES = 16000 * 4 * 2
    is_recording = False

    # sending failure events function:
    async def send_failure_event(severity: str, message: str, **kwargs):
        await manager.send_event(
            websocket, "failure_event", message, session_id, severity=severity, **kwargs
        )

    async def safe_redis(coro):
        try:
            result = await coro
            await notify_redis_recovered(send_failure_event)
            return result
        except Exception as e:
            await notify_redis_down(send_failure_event)
            print(f"Redis skipped: {e}")
            return None

    # The cleanest way is to send a dedicated ping from FastAPI to Redis and report it back as an event
    async def measure_redis_latency() -> int:
        start = time.time()
        await redis_client.ping()
        return int((time.time() - start) * 1000)

    # while using whisper this task will be created
    async def redis_latency_alive():
        try:
            while True:
                await asyncio.sleep(5)  # every 5s
                try:
                    redis_latency = await measure_redis_latency()
                    await manager.send_event(
                        websocket,
                        "redis_health",
                        "Redis ping ok",
                        session_id,
                        redis_latency=redis_latency,
                    )
                except Exception as e:
                    await safe_redis(
                        RedisVoiceStore.append_system_event(
                            session_id, "error", f"Redis Fault: {str(e)}"
                        )
                    )
                    break  # if keepalive fails, connection is dead anyway
        except asyncio.CancelledError:
            pass

    # ── LLM + TTS background loop ─────────────────────────────────────────────
    async def process_text_and_voice():
        while True:
            try:
                user_text, calculated_asr_latency, total_latency, service = (
                    await transcript_queue.get()
                )
                await manager.send_event(
                    websocket, "llm_started", "Groq processing context...", session_id
                )
                await safe_redis(
                    RedisVoiceStore.append_system_event(
                        session_id, "llm_started", "Groq processing context..."
                    )
                )
                timers["llm_start"] = time.time()

                try:

                    # 1. Pull absolute historical records of all chat text chunks recorded in Redis memory
                    db_chats = await safe_redis(
                        RedisVoiceStore.get_session_chats(session_id)
                    )

                    # 2. Hard limit slicing rule targeting maximum latest 5 messages
                    limited_db_chats = (
                        db_chats[-5:] if (db_chats and len(db_chats) > 5) else db_chats
                    )

                    # 3. Compile structural list payload array mapping natively expected by Groq LPU API hooks
                    groq_messages = [
                        {
                            "role": "system",
                            "content": f"You are a sub-100ms voice pipeline assistant. Keep answers concise, direct, and conversational. Do not use markdown formatting. The user's name is {username}, use it naturally in conversation.",
                        }
                    ]

                    # 4. Map the stored Redis rows down into the conversational context tree loops
                    if limited_db_chats:
                        for chat in limited_db_chats:
                            groq_messages.append(
                                {"role": chat.get("role"), "content": chat.get("text")}
                            )

                    if groq_messages[-1]["content"] != user_text:
                        groq_messages += [{"role": "user", "content": user_text}]

                    response_stream = await groq_client.chat.completions.create(
                        model="openai/gpt-oss-120b",
                        messages=groq_messages,
                        stream=True,
                        temperature=0.4,
                    )

                    assistant_text_buffer = ""
                    first_token_sent = False
                    llm_latency = 0
                    tts_buffer = ""
                    first_audio_sent = False
                    # At start of LLM processing, before the stream loop
                    tts_failed = False

                    # sentence-ending punctuation pattern
                    SENTENCE_END = re.compile(r"[.,;!?]\s*$")

                    async for chunk in response_stream:
                        delta = chunk.choices[0].delta if chunk.choices else None
                        if not delta or not delta.content:
                            continue

                        text_content = delta.content

                        if not first_token_sent:
                            llm_latency = int(
                                (time.time() - timers["llm_start"]) * 1000
                            )
                            await manager.send_event(
                                websocket,
                                "first_token",
                                text_content,
                                session_id,
                                text_chunk=text_content,
                                asr_latency=calculated_asr_latency,
                                llm_latency=llm_latency,
                            )
                            await safe_redis(
                                RedisVoiceStore.append_system_event(
                                    session_id,
                                    "first_token",
                                    text_content,
                                    **{"speaker": "assistant"},
                                )
                            )
                            first_token_sent = True

                            await manager.send_event(
                                websocket,
                                "tts_started",
                                "Spawning Cartesia stream...",
                                session_id,
                            )
                            await safe_redis(
                                RedisVoiceStore.append_system_event(
                                    session_id,
                                    "tts_started",
                                    "Spawning Cartesia stream...",
                                )
                            )

                        assistant_text_buffer += text_content
                        await manager.send_event(
                            websocket,
                            "transcript_partial",
                            assistant_text_buffer,
                            session_id,
                            text=assistant_text_buffer,
                            speaker="assistant",
                        )
                        await safe_redis(
                            RedisVoiceStore.append_system_event(
                                session_id,
                                "transcript_partial",
                                assistant_text_buffer,
                                **{"speaker": "assistant"},
                            )
                        )

                        # accumulate into TTS buffer
                        tts_buffer += text_content

                        # only send to TTS when we have a complete sentence
                        if not tts_failed and SENTENCE_END.search(tts_buffer):
                            cleaned = clean_for_tts(tts_buffer)
                            tts_buffer = ""  # reset buffer

                            if not is_speakable(cleaned):
                                continue  # skip code/punctuation-only chunks

                            timers["tts_start"] = time.time()

                            try:
                                tts_stream = await asyncio.wait_for(
                                    cartesia_client.tts.sse(
                                        model_id="sonic-3.5",
                                        transcript=cleaned,
                                        voice={
                                            "id": "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
                                        },  # ← fix this
                                        output_format={
                                            "container": "raw",
                                            "encoding": "pcm_s16le",
                                            "sample_rate": 16000,
                                        },
                                        context_id=context_id,
                                    ),
                                    timeout=5.0,
                                )

                                async for tts_chunk in tts_stream:
                                    if tts_chunk.type == "error":
                                        break
                                    if tts_chunk.type == "done":
                                        break
                                    if tts_chunk.type == "chunk":
                                        audio_data = tts_chunk.audio
                                        if audio_data:
                                            b64_audio = base64.b64encode(
                                                audio_data
                                            ).decode("utf-8")

                                            if not first_audio_sent:
                                                first_audio_sent = True
                                                tts_latency = int(
                                                    (time.time() - timers["tts_start"])
                                                    * 1000
                                                )
                                                calculated_total_latency = int(
                                                    (time.time() - total_latency) * 1000
                                                )
                                                await manager.send_event(
                                                    websocket,
                                                    "first_audio_byte",
                                                    "Audio chunk flushed.",
                                                    session_id,
                                                    chunk=b64_audio,
                                                    service=service,
                                                    asr_latency=calculated_asr_latency,
                                                    llm_latency=llm_latency,
                                                    tts_latency=tts_latency,
                                                    total_latency=calculated_total_latency,
                                                )
                                                await safe_redis(
                                                    RedisVoiceStore.append_system_event(
                                                        session_id,
                                                        "first_audio_byte",
                                                        "Audio chunk flushed.",
                                                        **{
                                                            "asr_latency": calculated_asr_latency,
                                                            "llm_latency": llm_latency,
                                                            "tts_latency": tts_latency,
                                                            "total_latency": calculated_total_latency,
                                                            "service": service,
                                                        },
                                                    )
                                                )

                                            await manager.send_event(
                                                websocket,
                                                "audio_chunk",
                                                "Audio chunk flushed.",
                                                session_id,
                                                chunk=b64_audio,
                                            )
                                            await safe_redis(
                                                RedisVoiceStore.append_system_event(
                                                    session_id,
                                                    "audio_chunk",
                                                    "Audio chunk flushed.",
                                                )
                                            )

                            except asyncio.TimeoutError:
                                tts_failed = True
                                await manager.send_event(
                                    websocket,
                                    "error",
                                    "TTS Fault: timeout",
                                    session_id,
                                ),
                                await safe_redis(
                                    RedisVoiceStore.append_system_event(
                                        session_id, "error", "TTS Fault: timeout"
                                    )
                                )
                                await handle_cartesia_failure(
                                    websocket,
                                    manager,
                                    session_id,
                                    "TTS Fault: timeout",
                                    send_failure_event,
                                )
                            except Exception as e:
                                tts_failed = True
                                await manager.send_event(
                                    websocket,
                                    "error",
                                    f"TTS Fault: {str(e)}",
                                    session_id,
                                ),
                                await safe_redis(
                                    RedisVoiceStore.append_system_event(
                                        session_id, "error", f"TTS Fault: {str(e)}"
                                    )
                                )
                                await handle_cartesia_failure(
                                    websocket,
                                    manager,
                                    session_id,
                                    f"TTS Fault: {str(e)}",
                                    send_failure_event,
                                )

                    # after LLM stream ends, flush any remaining buffer
                    if not tts_failed and tts_buffer:
                        cleaned = clean_for_tts(tts_buffer)
                        if is_speakable(cleaned):
                            # same TTS call as above for the remainder
                            try:
                                tts_stream = await asyncio.wait_for(
                                    cartesia_client.tts.sse(
                                        model_id="sonic-3.5",
                                        transcript=cleaned,
                                        voice={
                                            "id": "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"
                                        },
                                        output_format={
                                            "container": "raw",
                                            "encoding": "pcm_s16le",
                                            "sample_rate": 16000,
                                        },
                                        context_id=context_id,
                                    ),
                                    timeout=5.0,
                                )
                                async for tts_chunk in tts_stream:
                                    if tts_chunk.type == "done":
                                        break
                                    if tts_chunk.type == "chunk" and tts_chunk.audio:
                                        b64_audio = base64.b64encode(
                                            tts_chunk.audio
                                        ).decode("utf-8")
                                        await manager.send_event(
                                            websocket,
                                            "audio_chunk",
                                            "Audio chunk flushed.",
                                            session_id,
                                            chunk=b64_audio,
                                        )
                                        await safe_redis(
                                            RedisVoiceStore.append_system_event(
                                                session_id,
                                                "audio_chunk",
                                                "Audio chunk flushed.",
                                            )
                                        )
                            except Exception as e:
                                tts_failed = True
                                await manager.send_event(
                                    websocket,
                                    "error",
                                    f"TTS Fault: {str(e)}",
                                    session_id,
                                ),
                                await safe_redis(
                                    RedisVoiceStore.append_system_event(
                                        session_id, "error", f"TTS Fault: {str(e)}"
                                    )
                                )
                                await handle_cartesia_failure(
                                    websocket,
                                    manager,
                                    session_id,
                                    f"TTS Fault: {str(e)}",
                                    send_failure_event,
                                )

                    # Commit completely assembled AI answer segment directly into Redis
                    await safe_redis(
                        RedisVoiceStore.append_chat_message(
                            session_id=session_id,
                            role="assistant",
                            text=assistant_text_buffer,
                            user_id=user_id,
                        )
                    )

                    await manager.send_event(
                        websocket, "llm_completed", "Groq stream finalized.", session_id
                    )
                    await safe_redis(
                        RedisVoiceStore.append_system_event(
                            session_id, "llm_completed", "Groq stream finalized."
                        )
                    )
                    await manager.send_event(
                        websocket,
                        "transcript_final",
                        assistant_text_buffer,
                        session_id,
                        text=assistant_text_buffer,
                        speaker="assistant",
                    )
                    await safe_redis(
                        RedisVoiceStore.append_system_event(
                            session_id,
                            "transcript_final",
                            assistant_text_buffer,
                            **{"speaker": "assistant"},
                        )
                    )
                    await manager.send_event(
                        websocket,
                        "tts_completed",
                        "Cartesia buffer cycle cleared.",
                        session_id,
                    )
                    await safe_redis(
                        RedisVoiceStore.append_system_event(
                            session_id,
                            "tts_completed",
                            "Cartesia buffer cycle cleared.",
                        )
                    )
                    await manager.send_event(
                        websocket,
                        "response_completed",
                        "System idling for next phrase.",
                        session_id,
                    )
                    await safe_redis(
                        RedisVoiceStore.append_system_event(
                            session_id,
                            "response_completed",
                            "System idling for next phrase.",
                        )
                    )

                except Exception as e:
                    await manager.send_event(
                        websocket, "error", f"Orchestration Error: {str(e)}", session_id
                    )
                    await safe_redis(
                        RedisVoiceStore.append_system_event(
                            session_id, "error", f"Orchestration Error: {str(e)}"
                        )
                    )
                    # tell user what happened
                    await manager.send_event(
                        websocket,
                        "assistant_error",
                        "I encountered an error processing your request. Please try again.",
                        session_id,
                        text="I encountered an error processing your request. Please try again.",
                        speaker="assistant",
                    )
                finally:
                    transcript_queue.task_done()

            except Exception as outer_e:
                await manager.send_event(
                    websocket, "error", f"Error is : {str(e)}", session_id
                ),
                await safe_redis(
                    RedisVoiceStore.append_system_event(
                        session_id, "error", f"Error is : {str(e)}"
                    )
                )

    # Create ONCE in outer scope — survives retries
    pipeline_task = asyncio.create_task(process_text_and_voice())
    redis_task = asyncio.create_task(redis_latency_alive())

    # At the START of run_pipeline, reset asr timer
    async def run_pipeline(dg_connection):
        nonlocal is_recording
        timers["asr_start"] = 0.0  # ← reset.
        timers["total_start"] = 0.0
        asr_first_result[0] = False  # ← reset
        asr_latency_final[0] = 0  # ← reset

        # --- Helper Async Functions to run on the Main Loop ---
        async def handle_message_async(preview):
            # 1. Send WebSocket event
            await manager.send_event(
                websocket,
                "transcript_partial",
                preview,
                session_id,
                text=preview,
                speaker="user",
            )
            # 2. Append to Redis immediately after
            await safe_redis(
                RedisVoiceStore.append_system_event(
                    session_id,
                    "transcript_partial",
                    preview,
                    **{"speaker": "user"},
                )
            )

        async def handle_error_async(error_msg):
            # 1. Send Error to WebSocket
            await manager.send_event(websocket, "error", error_msg, session_id)
            # 2. Append Error state to Redis immediately after
            await safe_redis(
                RedisVoiceStore.append_system_event(session_id, "error", f"{error_msg}")
            )

        # result is a union type; filter for ListenV1Results only
        def on_message(result):

            if not isinstance(result, ListenV1Results):
                return
            if not result.channel or not result.channel.alternatives:
                return

            sentence = result.channel.alternatives[0].transcript
            if not sentence:
                return

            # capture ASR latency on very first transcript chunk
            if not asr_first_result[0] and timers["asr_start"] > 0:
                asr_latency_final[0] = int((time.time() - timers["asr_start"]) * 1000)
                asr_first_result[0] = True

            # detect Deepgram reset — new partial shorter than previous
            # means a pause happened and Deepgram started fresh
            if (
                last_partial[0]  # we had something before
                and sentence.lower().strip()
                != last_partial[0].lower().strip()  # new is shorter = reset
                and not partial_match(last_partial[0].strip(), sentence.strip())
                and last_partial[0].lower().strip()
                not in confirmed_buffer[0].lower().strip()  # not already saved
            ):
                # save the previous completed chunk before it's lost
                confirmed_buffer[0] = (
                    confirmed_buffer[0] + " " + last_partial[0]
                ).strip()

            last_partial[0] = sentence

            # show full preview = confirmed + current partial
            preview = (confirmed_buffer[0] + " " + sentence).strip()

            asyncio.get_event_loop().call_soon_threadsafe(
                lambda: asyncio.ensure_future(handle_message_async(preview))
            )

        deepgram_failed = asyncio.Event()
        deepgram_error = {"message": None}
        loop = asyncio.get_running_loop()

        def on_error(error, **kwargs):
            error_msg = f"ASR Fault: {str(error)}"

            def mark_deepgram_dead():
                deepgram_error["message"] = error_msg
                deepgram_failed.set()
                asyncio.create_task(handle_error_async(error_msg))

            loop.call_soon_threadsafe(mark_deepgram_dead)

        async def send_deepgram_keepalive():
            try:
                while not deepgram_failed.is_set():
                    await asyncio.sleep(3)  # 3 seconds is fine

                    try:
                        await dg_connection.send_keep_alive()
                    except Exception as e:
                        error_msg = f"Deepgram keepalive failed: {str(e)}"

                        deepgram_error["message"] = error_msg
                        deepgram_failed.set()
                        await handle_error_async(error_msg)
                        return

            except asyncio.CancelledError:
                raise

        # FIX 3: EventType.MESSAGE / EventType.ERROR not raw strings
        dg_connection.on(EventType.MESSAGE, on_message)
        dg_connection.on(EventType.ERROR, on_error)

        # FIX 4: Run start_listening() as a background task so audio
        #         ingestion loop below can run concurrently
        listen_task = asyncio.create_task(dg_connection.start_listening())

        # Give the listener task a chance to begin
        await asyncio.sleep(0)

        # New Deepgram connection: immediately send latest available audio
        if recent_audio:
            try:
                print(f"Replaying {len(recent_audio)} bytes to reconnected Deepgram")
                await dg_connection.send_media(bytes(recent_audio))
            except Exception as e:
                raise ConnectionError(f"Could not replay audio after reconnect: {e}")

        # Spawn the keepalive runner task as soon as the connection block is open
        keepalive_task = asyncio.create_task(send_deepgram_keepalive())

        receive_task = asyncio.create_task(websocket.receive())
        deepgram_failure_task = asyncio.create_task(deepgram_failed.wait())

        # ── Audio ingestion loop ──────────────────────────────────────────
        try:
            while True:
                try:
                    done, pending = await asyncio.wait(
                        {receive_task, deepgram_failure_task},
                        return_when=asyncio.FIRST_COMPLETED,
                    )

                    # Deepgram connection died → exit run_pipeline → retry wrapper reconnects
                    if deepgram_failure_task in done:
                        error_msg = (
                            deepgram_error["message"] or "Deepgram connection lost"
                        )

                        receive_task.cancel()
                        await asyncio.gather(receive_task, return_exceptions=True)
                        raise DeepgramConnectionError(error_msg)  # custom exception

                    # Browser sent something
                    message = receive_task.result()

                    # Create the next receive task immediately
                    receive_task = asyncio.create_task(websocket.receive())

                    # check disconnect type FIRST before processing
                    if message.get("type") == "websocket.disconnect":
                        await manager.send_event(
                            websocket,
                            "error",
                            "Websocket Disconnects issue",
                            session_id,
                        ),

                        # Append to Redis immediately after
                        await safe_redis(
                            RedisVoiceStore.append_system_event(
                                session_id,
                                "error",
                                f"Websocket Disconnects Error",
                            )
                        )
                        break
                except WebSocketDisconnect:
                    break
                except DeepgramConnectionError:
                    raise  # ← let it bubble up, don't swallo
                except Exception as e:
                    print(f"Receive error: {str(e) if e else None }")
                    break

                if "bytes" in message:
                    raw_pcm_bytes = message["bytes"]

                    # This is the first browser audio chunk of a truly new recording
                    if not is_recording:
                        is_recording = True

                        recent_audio.clear()  # clear only old recording audio
                        timers["asr_start"] = time.time()
                        asr_first_result[0] = False

                    # FIX 5: correct method is send_media(), not send()
                    if raw_pcm_bytes:
                        # Add current browser audio to the SAME session buffer
                        recent_audio.extend(raw_pcm_bytes)

                        # Keep only the latest ~2 seconds:
                        if len(recent_audio) > MAX_RECENT_AUDIO_BYTES:
                            del recent_audio[:-MAX_RECENT_AUDIO_BYTES]

                        # Send current audio to current Deepgram connection
                        await dg_connection.send_media(raw_pcm_bytes)

                elif "text" in message:
                    data = json.loads(message["text"])
                    #  Intercept the client network telemetry ping packets
                    if data.get("type") == "ping":
                        # Instantly bounce back the exact same payload dictionary labeled as a 'pong'
                        pong_payload = {
                            "type": "pong",
                            "startTime": data.get("startTime"),
                        }
                        await websocket.send_text(json.dumps(pong_payload))

                    elif data.get("type") == "stop_recording":
                        service = "deepgram"
                        timers["total_start"] = time.time()

                        # merge confirmed + whatever partial came last
                        last = last_partial[0].strip()
                        confirmed = confirmed_buffer[0].strip()

                        # use partial_match to catch overlap, not just exact string check
                        if (
                            last
                            and not partial_match(last, confirmed)
                            and last not in confirmed
                        ):
                            full_text = (confirmed + " " + last).strip()
                        else:
                            # last is already inside confirmed or overlaps — just use confirmed
                            # but if confirmed is empty, fall back to last
                            full_text = confirmed if confirmed else last

                        if full_text:
                            # Commit user statement into Redis list clusters asynchronously
                            await safe_redis(
                                RedisVoiceStore.append_chat_message(
                                    session_id=session_id,
                                    role="user",
                                    text=full_text,
                                    user_id=user_id,
                                )
                            )
                            await manager.send_event(
                                websocket,
                                "transcript_final",
                                full_text,
                                session_id,
                                text=full_text,
                                speaker="user",
                            )
                            # 2. Append to Redis immediately after
                            await safe_redis(
                                RedisVoiceStore.append_system_event(
                                    session_id,
                                    "transcript_final",
                                    full_text,
                                    **{"speaker": "user"},
                                )
                            )
                            await transcript_queue.put(
                                (
                                    full_text,
                                    asr_latency_final[0],
                                    timers["total_start"],
                                    service,
                                )
                            )

                            is_recording = False
                            recent_audio.clear()  # recording is finished
                            last_partial[0] = ""
                            confirmed_buffer[0] = ""
                            timers["asr_start"] = 0.0  # reset for next recording
                            timers["total_start"] = 0.0
                            asr_first_result[0] = False

        except DeepgramConnectionError:
            raise  # ← re-raise, don't swallow it
        except Exception as e:
            await manager.send_event(
                websocket, "error", f"Error is: {str(e)}", session_id
            ),
            # 2. Append to Redis immediately after
            await safe_redis(
                RedisVoiceStore.append_system_event(
                    session_id, "error", f"Error is : {str(e)}"
                )
            )
        finally:
            listen_task.cancel()
            keepalive_task.cancel()
            receive_task.cancel()
            deepgram_failure_task.cancel()

            # wait for tasks to actually stop
            await asyncio.gather(
                listen_task,
                keepalive_task,
                receive_task,
                deepgram_failure_task,
                return_exceptions=True,  # don't raise CancelledError
            )

            # Finalize your transaction records within the Redis cluster
            await safe_redis(RedisVoiceStore.finalize_session(session_id))

            # safely close deepgram — guard against already-dead socket
            try:
                await dg_connection.send_close_stream()
            except Exception as e:
                print(f"Deepgram close skipped (already closed): {e}")

    # ── Open Deepgram WebSocket ───────────────────────────────────────────────
    try:
        async with deepgram_client.listen.v1.connect(
            model="nova-3",
            smart_format=True,
            language="en-US",
            encoding="linear16",
            sample_rate=16000,
            interim_results=True,
        ) as dg_connection:

            await run_pipeline(dg_connection)

    except Exception as e:

        await manager.send_event(
            websocket, "error", f"Deepgram Fault: {str(e)}", session_id
        ),
        await safe_redis(
            RedisVoiceStore.append_system_event(
                session_id, "error", f"Deepgram Fault: {str(e)}"
            )
        )

        result = await run_with_deepgram_retry(
            deepgram_client, run_pipeline, send_failure_event, DeepgramConnectionError
        )

        pipeline_task.cancel()
        redis_task.cancel()
        await asyncio.gather(pipeline_task, redis_task, return_exceptions=True)

        if result is None:
            # IMPORTANT: restart queue consumer because old pipeline_task
            # was cancelled when Deepgram failed.
            # Spawn the keepalive runner task as soon as the connection block is open
            try:
                fallback_pipeline_task = asyncio.create_task(process_text_and_voice())
                redis_alive_task = asyncio.create_task(redis_latency_alive())
                await whisper_fallback_loop(
                    websocket,
                    manager,
                    session_id,
                    transcript_queue,
                    send_failure_event,
                    user_id,
                    safe_redis,
                )
            finally:
                fallback_pipeline_task.cancel()
                redis_alive_task.cancel()

                await asyncio.gather(
                    fallback_pipeline_task,
                    redis_alive_task,
                    return_exceptions=True,
                )

        try:
            await websocket.close()
        except Exception:
            pass
        manager.disconnect(websocket)
