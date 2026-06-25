# Handles: Deepgram retry logic, Whisper fallback, Cartesia text fallback,

import asyncio
import os
import time
import tempfile
import wave
from typing import Optional
import json
from fastapi import WebSocketDisconnect
from database import RedisVoiceStore

# ── Whisper (Local) ──────────────────────────────────────────────────────────
from faster_whisper import WhisperModel

# Load once at startup — "base" is fast, "small" is more accurate
# device="cpu" works fine, use "cuda" if you have GPU
whisper_model = WhisperModel("base", device="cpu", compute_type="int8")

_redis_was_down = False  # module-level flag to track state

# ─────────────────────────────────────────────────────────────────────────────
# 1. REDIS WRAPPER
# ─────────────────────────────────────────────────────────────────────────────


async def notify_redis_down(send_failure_event):
    global _redis_was_down
    if not _redis_was_down:  # only notify once, not on every call
        _redis_was_down = True
        await send_failure_event(
            "error",
            "Redis unavailable. Session data will not persist until restored.",
            service="redis",
            action="Data persistence paused",
        )


async def notify_redis_recovered(send_failure_event):
    global _redis_was_down
    if _redis_was_down:  # only notify if it was actually down
        _redis_was_down = False
        await send_failure_event(
            "recovery",
            "Redis connection restored. Session data is now persisting.",
            service="redis",
            action="Data persistence resumed",
        )


# ─────────────────────────────────────────────────────────────────────────────
# 1. DEEPGRAM RETRY WRAPPER
# ─────────────────────────────────────────────────────────────────────────────

MAX_DG_RETRIES = 3
DG_RETRY_DELAY = 1.5  # seconds between retries


async def run_with_deepgram_retry(
    deepgram_client, handler_fn, send_failure_event, DeepgramConnectionError
):
    """
    Tries to run handler_fn(dg_connection) inside async with block up to 3 times.
    handler_fn is your entire audio ingestion + pipeline logic.
    """
    global _dg_test_fail_count

    for attempt in range(1, MAX_DG_RETRIES + 1):
        try:
            await send_failure_event(
                "warning",
                f"Deepgram reconnect attempt {attempt}/{MAX_DG_RETRIES}...",
                service="deepgram",
                action=f"Retry Attempt {attempt}/{MAX_DG_RETRIES}",
            )

            async with deepgram_client.listen.v1.connect(
                model="nova-3",
                smart_format=True,
                language="en-US",
                encoding="linear16",
                sample_rate=16000,
                interim_results=True,
            ) as dg_connection:

                await send_failure_event(
                    "recovery",
                    f"Deepgram reconnected on attempt {attempt}.",
                    service="deepgram",
                    action="Connection restored",
                )
                await handler_fn(dg_connection)
                return  # clean exit, don't retry

        except DeepgramConnectionError as e:
            # Deepgram died mid-session → retry
            await send_failure_event(
                "error",
                f"Deepgram lost on attempt {attempt}/3: {str(e)}",
                service="deepgram",
                action=(
                    f"Retry Attempt {attempt}/3"
                    if attempt < 3
                    else "Fallback → Whisper"
                ),
            )
            if attempt < 3:
                await asyncio.sleep(1.5)

        except Exception as e:
            await send_failure_event(
                "error",
                f"Deepgram attempt {attempt} failed: {str(e)}",
                service="deepgram",
                action=(
                    f"Retry {attempt}/{MAX_DG_RETRIES}"
                    if attempt < MAX_DG_RETRIES
                    else "Fallback → Whisper"
                ),
            )
            if attempt < MAX_DG_RETRIES:
                await asyncio.sleep(1.5)

    # All 3 failed — return None to signal Whisper fallback
    return None


# ─────────────────────────────────────────────────────────────────────────────
# 2. WHISPER FALLBACK — transcribe raw PCM bytes
# ─────────────────────────────────────────────────────────────────────────────


async def transcribe_with_whisper(
    pcm_bytes: bytes, sample_rate: int = 16000
) -> Optional[str]:
    tmp_path = None  # ← define before try so finally always has it
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = tmp.name
            with wave.open(tmp_path, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(sample_rate)
                wf.writeframes(pcm_bytes)

        loop = asyncio.get_event_loop()
        segments, _ = await loop.run_in_executor(
            None, lambda: whisper_model.transcribe(tmp_path, language="en")
        )
        text = " ".join(seg.text for seg in segments).strip()
        return text or None

    except Exception as e:
        return None
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


async def whisper_fallback_loop(
    websocket,
    manager,
    session_id,
    transcript_queue,
    send_failure_event,
    user_id,
    safe_redis,
):
    """Runs when Deepgram fails all 3 retries. Collects PCM and transcribes via Whisper on stop_recording."""

    await send_failure_event(
        "error",
        "Deepgram unreachable after 3 attempts. Switched to Whisper (local).",
        service="deepgram",
        action="Fallback → Whisper activated",
    )
    await manager.send_event(
        websocket,
        "asr_fallback",
        "Voice input now handled by Whisper. Slight delay expected.",
        session_id,
    )

    pcm_buffer = bytearray()

    try:
        while True:
            try:
                message = await websocket.receive()
                if message.get("type") == "websocket.disconnect":
                    break
            except WebSocketDisconnect:
                break
            except Exception as e:
                print(f"Whisper loop receive error: {e}")
                break

            if "bytes" in message:
                # Just accumulate — no Deepgram to stream to
                pcm_buffer.extend(message["bytes"])

            elif "text" in message:
                data = json.loads(message["text"])

                if data.get("type") == "ping":
                    await websocket.send_text(
                        json.dumps({"type": "pong", "startTime": data.get("startTime")})
                    )

                elif data.get("type") == "stop_recording":
                    if not pcm_buffer:
                        continue

                    total_latency = time.time()
                    service = "whisper"

                    await manager.send_event(
                        websocket,
                        "asr_started",
                        "Whisper transcribing audio...",
                        session_id,
                    )

                    # Transcribe accumulated PCM
                    text = await transcribe_with_whisper(bytes(pcm_buffer))
                    pcm_buffer.clear()

                    if text:
                        asr_latency = int((time.time() - total_latency) * 1000)

                        await manager.send_event(
                            websocket,
                            "transcript_final",
                            text,
                            session_id,
                            text=text,
                            speaker="user",
                            service="whisper",
                        )
                        await safe_redis(
                            RedisVoiceStore.append_chat_message(
                                session_id=session_id,
                                role="user",
                                text=text,
                                user_id=user_id,
                            )
                        )

                        await safe_redis(
                            RedisVoiceStore.append_system_event(
                                session_id, "transcript_final", text, speaker="user"
                            )
                        )

                        # Push into same queue — LLM+TTS pipeline handles the rest normally
                        await transcript_queue.put(
                            (text, asr_latency, total_latency, service)
                        )
                    else:
                        await manager.send_event(
                            websocket,
                            "error",
                            "Whisper could not transcribe. Please speak clearly and try again.",
                            session_id,
                        )

    except Exception as e:
        await send_failure_event(
            "error",
            f"Whisper fallback error: {str(e)}",
            service="whisper",
            action="Fallback loop crashed",
        )


# ─────────────────────────────────────────────────────────────────────────────
# 3. CARTESIA FALLBACK — text-only mode when TTS fails
# ─────────────────────────────────────────────────────────────────────────────


async def handle_cartesia_failure(
    websocket, manager, session_id: str, text: str, send_event_fn
):
    """
    Called when Cartesia TTS is unavailable.
    Notifies the frontend to switch to text-only display.
    """
    await send_event_fn(
        "error",
        "Cartesia TTS unavailable. Switched to text-only output.",
        service="cartesia",
        action="Fallback → Text Output",
    )
    # Send a dedicated event so frontend can show text bubble instead of playing audio
    await manager.send_event(
        websocket,
        "tts_unavailable",
        "Voice output inactive. Displaying text response only.",
        session_id,
        text=text,  # full LLM response text still delivered
    )
