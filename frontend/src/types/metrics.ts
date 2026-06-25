export interface LatencyMetric {
  asr: number;       // ms
  llm: number;       // ms
  tts: number;       // ms
  total: number;     // ms
  timestamp: string; // HH:MM:SS
}

// src/types/metrics.ts

export type ServiceName = 'deepgram' | 'groq' | 'cartesia' | 'redis' | 'websocket' | 'whisper';

export interface ServiceTelemetry {
  status: 'healthy' | 'unhealthy';
  latency: number;          // ms
  lastCheck: string;        // HH:MM:SS
  errorCount: number;
  label: string;
}

