import type { ServiceName } from "./metrics";

export type FailureSeverity = 'error' | 'warning' | 'recovery';

export interface FailureEvent {
  id: string;
  timestamp: string;        // formatted HH:MM:SS
  severity: FailureSeverity;
  service: ServiceName;          // 'deepgram' | 'groq' | 'cartesia' | 'redis' | 'websocket'
  message: string;          // e.g. "Deepgram timeout"
  action?: string;          // e.g. "Fallback → Whisper" | "Retry Attempt 1/3"
  requestId?: string;       // optional trace ID
}