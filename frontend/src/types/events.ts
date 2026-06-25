import type { FailureSeverity } from "./failures";
import type { ServiceName } from "./metrics";

export type VoiceEventType =
  | 'audio_chunk_received'
  | 'transcript_partial'
  | 'transcript_final'
  | 'llm_started'
  | 'first_token'
  | 'llm_completed'
  | 'tts_started'
  | 'first_audio_byte'
  | 'audio_chunk'
  | 'tts_completed'
  | 'response_completed'
  | 'websocket'
  | 'assistant_error'
  | 'redis_health'
  | 'failure_event'
  | 'tts_unavailable'
  | 'error';

export interface BaseVoiceEvent {
  event_type: VoiceEventType;
  timestamp: number;
  session_id: string;
}

// 1. Telemetry Log Structure (Used internally by Zustand state store)
export interface VoiceEventLog extends BaseVoiceEvent {
  id: string;
  formattedTime: string;
  message: string;
  speaker: string;
}

// 2. Chat Component Display Model (Used inside ChatPanel)
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isStreaming: boolean;
}

// 3. Raw Incoming Server Data Frame Map (Used directly in useSocket.ts)
export interface ServerWebSocketPayload extends BaseVoiceEvent {
  message: string | "";
  text?: string;
  speaker?: 'user' | 'assistant';
  chunk?: string;         // Base64 Cartesia audio snippet
  redis_latency?: number,
  asr_latency?: number;   // Measured time performance metrics
  llm_latency?: number;
  tts_latency?: number;
  total_latency?: number;
  severity: FailureSeverity | "recovery";
  service: ServiceName;
  action?: string;
  request_id ?: string;
}