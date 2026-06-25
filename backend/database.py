# backend/database.py
import os
import json
import time
import redis.asyncio as aioredis
from dotenv import load_dotenv

if os.environ.get("ENV") != "production":
    load_dotenv()  # only loads .env file in local dev, ignored in Docker

_LOCAL_CHAT_STORE = {}

# Initialize an asynchronous, connection-pooled Redis engine client
redis_client = aioredis.from_url(
    os.environ.get("REDIS_URL", "redis://localhost:6379"), decode_responses=True
)


class RedisVoiceStore:
    """Production-grade Redis manager handling in-memory user sessions and voice history."""

    @staticmethod
    async def create_user_profile(
        user_id: str, username: str, email: str = "guest@platform.dev"
    ):
        """Stores global user parameters inside a structured Redis Hash table."""
        user_key = f"user:{user_id}"
        payload = {
            "user_id": user_id,
            "username": username,
            "email": email,
            "created_at": int(time.time() * 1000),
        }
        await redis_client.hset(user_key, mapping=payload)
        return payload

    @staticmethod
    async def initialize_session_meta(session_id: str, user_id: str):
        """Pairs a brand-new real-time streaming voice track to an owner ID block."""
        session_key = f"session_meta:{session_id}"
        payload = {
            "session_id": session_id,
            "user_id": user_id,
            "started_at": int(time.time() * 1000),
            "status": "active",
        }
        await redis_client.hset(session_key, mapping=payload)
        return payload

    @staticmethod
    async def append_chat_message(session_id: str, role: str, text: str, user_id: str):
        """Appends a dialogue turn directly to a chronological list array track."""
        chat_history_key = f"session_chats:{session_id}"
        message_data = {
            "id": f"msg_{int(time.time() * 1000)}",
            "user_id": user_id,
            "role": role,  # 'user' or 'assistant'
            "text": text,
            "timestamp": int(time.time() * 1000),
        }
        # Push to the tail of the list. Fast in-memory array operation.
        await redis_client.rpush(chat_history_key, json.dumps(message_data))
        return message_data

    @staticmethod
    async def get_session_chats(session_id: str) -> list:
        """Retrieves a complete chronological record of all text utterances in a session."""
        chat_history_key = f"session_chats:{session_id}"
        # Fetch every item inside the list array buffer index tree layout from 0 to -1
        raw_messages = await redis_client.lrange(chat_history_key, 0, -1)
        return [json.loads(msg) for msg in raw_messages]

    @staticmethod
    async def finalize_session(session_id: str):
        """Marks an active pipeline execution path closed when wiped."""
        session_key = f"session_meta:{session_id}"
        await redis_client.hset(session_key, "status", "completed")

    # backend/database.py -> Add inside the RedisVoiceStore class

    @staticmethod
    async def append_system_event(
        session_id: str, event_type: str, message: str, **kwargs
    ):
        events_key = f"session_events:{session_id}"

        # ── DEDUP: check last stored event before appending ──────────────────
        try:
            # Get the last event in the list (tail)
            raw_last = await redis_client.lindex(events_key, -1)
            if raw_last:
                last_event = json.loads(raw_last)
                # Squash consecutive identical partials — same type + same message
                if (
                    last_event.get("event_type") == event_type
                    and last_event.get("message") == message
                ):
                    return last_event  # Skip storing, return early

                # For transcript_partial specifically: also squash same-type even if
                # message differs but it's within the same 50ms window (rapid fire)
                if event_type == "transcript_partial":
                    time_delta = int(time.time() * 1000) - last_event.get(
                        "timestamp", 0
                    )
                    if (
                        time_delta < 60
                        and last_event.get("event_type") == "transcript_partial"
                    ):
                        # Update in place instead of appending a new entry
                        updated = {
                            **last_event,
                            "message": message,
                            "timestamp": int(time.time() * 1000),
                        }
                        await redis_client.lset(events_key, -1, json.dumps(updated))
                        return updated

                if event_type == "audio_chunk":
                    time_delta = int(time.time() * 1000) - last_event.get(
                        "timestamp", 0
                    )
                    if (
                        time_delta < 60
                        and last_event.get("event_type") == "audio_chunk"
                    ):
                        # Update in place instead of appending a new entry
                        updated = {
                            **last_event,
                            "message": message,
                            "timestamp": int(time.time() * 1000),
                        }
                        await redis_client.lset(events_key, -1, json.dumps(updated))
                        return updated
        except Exception:
            pass
        # ── END DEDUP ─────────────────────────────────────────────────────────

        event_payload = {
            "id": f"evt_{int(time.time() * 1000)}_{event_type}",
            "event_type": event_type,
            "message": message,
            "timestamp": int(time.time() * 1000),
            **kwargs,
        }
        try:
            await redis_client.rpush(events_key, json.dumps(event_payload))
        except Exception:
            fallback_key = f"session_events:{session_id}"
            if fallback_key not in _LOCAL_CHAT_STORE:
                _LOCAL_CHAT_STORE[fallback_key] = []
                _LOCAL_CHAT_STORE[fallback_key].append(json.dumps(event_payload))
        return event_payload

    @staticmethod
    async def get_session_events(session_id: str) -> list:
        """Retrieves every structural telemetry trace logged across the pipeline's lifecycle."""
        events_key = f"session_events:{session_id}"
        try:
            raw_events = await redis_client.lrange(events_key, 0, -1)
        except Exception:
            raw_events = _LOCAL_CHAT_STORE.get(events_key, [])
        return [json.loads(evt) for evt in raw_events]
