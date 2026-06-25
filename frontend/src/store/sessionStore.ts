import { create } from 'zustand';
import { type VoiceEventLog, type ChatMessage } from '../types/events';
import { type LatencyMetric } from '../types/metrics';
// Import the selector middleware required by Zustand v5 for parameter tracking
import { subscribeWithSelector } from 'zustand/middleware';
import { type ServiceTelemetry, type ServiceName } from '../types/metrics';
import { type FailureEvent } from '../types/failures';

// Through redis we can make our server stateless and it helps when creating microservices and deploying multiple instances of application so multiple instances can access that data not just one application state 
// Redis also used for caching
// Cache Invalidate and TTL are two techniques which we use when datas stored in redis gets changed in main database but in redis old data is cached so cache invalidate cause redis to unstore this data and TTL means for any ttl time like for 60 seconds redis will serve data after that cache invalidate will occur 

interface SessionState {
  // Session details
  isConnected: boolean;
  isRecording: boolean;
  isMuted: boolean;
  ws: WebSocket | null;
  wsRtt: number; // Network round trip latency tracker
  statusState: 'idle' | 'recording' | 'processing' | 'speaking';
  sessionId: string;
  activeTab: 'interaction' | 'analytics';
  username: string;
  userId: string;
  email: string;
  isReplaying: boolean;
  showRegistration: boolean,
  asrService: 'deepgram' | 'whisper',
  
  // Data streams
  messages: ChatMessage[];
  eventLogs: VoiceEventLog[];
  metrics: LatencyMetric[];
  failures: FailureEvent[];
  health: Record<ServiceName, ServiceTelemetry>;


  // Actions
  setConnected: (status: boolean) => void;
  setRecording: (status: boolean) => void;
  setIsMuted: (muted: boolean) => void;
  setWs: (ws: WebSocket | null) => void;
  setWsRtt: (rtt: number) => void;

  addFailure: (failure: Omit<FailureEvent, 'id' | 'timestamp'>) => void;
  clearFailures: () => void;
  setStatusState: (state: 'idle' | 'recording' | 'processing' | 'speaking') => void;
  setActiveTab: (tab: 'interaction' | 'analytics') => void;
  addLog: (eventType: string, message: string, sessionId: string, speaker: string) => void;
  addMessage: (role: 'user' | 'assistant', text: string, isStreaming?: boolean) => void;
  updateLastMessage: (text: string, isStreaming?: boolean) => void;
  addMetric: (metric: LatencyMetric) => void;
  openRegistration: () => void,
  updateServiceHealth: (
    service: ServiceName, 
    update: Partial<Omit<ServiceTelemetry, 'label'>>
  ) => void;
  incrementServiceError: (service: ServiceName) => void;
  setAsrService: (asrService: 'deepgram' | 'whisper') => void;
  runSessionReplay: () => Promise<void>;
  clearSession: () => void;
}

// Wrap your entire store creation function with subscribeWithSelector
export const useSessionStore = create(
  subscribeWithSelector<SessionState>((set, get) => ({
  username: '',
  userId: '',
  email: '',
  isReplaying: false,
  isConnected: false,
  isRecording: false,
  statusState: 'idle',
  isMuted: false,
  asrService: 'deepgram' as 'deepgram' | 'whisper',
  showRegistration: true,
  ws: null,
  wsRtt: 0,
  sessionId: '',
  activeTab: 'interaction',
  messages: [],
  eventLogs: [],
  metrics: [],
  failures: [],
  health: {
      deepgram: { status: 'healthy', latency: 0, lastCheck: '--:--:--', errorCount: 0, label: 'Deepgram Engine' },
      groq: { status: 'healthy', latency: 0, lastCheck: '--:--:--', errorCount: 0, label: 'Groq LPU Node' },
      cartesia: { status: 'healthy', latency: 0, lastCheck: '--:--:--', errorCount: 0, label: 'Cartesia Audio Fabric' },
      redis: { status: 'healthy', latency: 0, lastCheck: '--:--:--', errorCount: 0, label: 'Cache Sync (Redis)' },
      websocket: { status: 'healthy', latency: 0, lastCheck: '--:--:--', errorCount: 0, label: 'Gateway Socket' },
      whisper: { status: 'healthy', latency: 0, lastCheck: '--:--:--', errorCount: 0, label: 'Whisper Engine' },
  },
  setConnected: (isConnected) => set({ isConnected }),
  setRecording: (isRecording) => set({ isRecording }),
  setIsMuted: (isMuted) => set({ isMuted }),
  openRegistration: () => set({ showRegistration: true }),
  setWs: (ws) => set({ ws }),
  setWsRtt: (wsRtt) => set({ wsRtt }), 
  setStatusState: (statusState) => set({ statusState }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setAsrService: (asrService: 'deepgram' | 'whisper') => set({ asrService: asrService }),

  updateServiceHealth: (service, update) => set((state) => {
      const time = new Date().toTimeString().split(' ')[0];
      return {
        health: {
          ...state.health,
          [service]: {
            ...state.health[service],
            ...update,
            lastCheck: time
          }
        }
      };
    }),

    incrementServiceError: (service) => set((state) => ({
      health: {
        ...state.health,
        [service]: {
          ...state.health[service],
          status: 'unhealthy',
          errorCount: state.health[service].errorCount + 1,
          lastCheck: new Date().toTimeString().split(' ')[0]
        }
      }
    })),

  addFailure: (failure) => set((state) => ({
    failures: [
      {
        ...failure,
        id: `fail_${Date.now()}`,
        timestamp: new Date().toTimeString().split(' ')[0],
      },
      ...state.failures,
    ].slice(0, 100),
  })),

  clearFailures: () => set({ failures: [] }),
  
  addLog: (eventType, message, sessionId, speaker, extraFields = {}) => set((state) => {

  // ── DEDUP 1: squash consecutive identical messages (matches Redis lindex -1 check) ──
  const lastLog = state.eventLogs[0]; // newest is at top
  if (lastLog && lastLog.event_type === eventType && lastLog.message === message) {
    return {};
  }

  // ── DEDUP 2: websocket link/disconnect squash ────────────────────────────────────
  if (eventType === 'websocket') {
    const latestWsLog = state.eventLogs.find((log) => log.event_type === 'websocket');
    if (latestWsLog) {
      if (message.includes('linked') && latestWsLog.message.includes('linked')) return {};
      if (message.includes('disconnected') && latestWsLog.message.includes('disconnected')) return {};
    }
  }

  // ── DEDUP 3: transcript_partial within 50ms → update in place (matches Redis lset logic) ──
  if (eventType === 'transcript_partial' && lastLog) {
    const timeDelta = Date.now() - lastLog.timestamp;
    if (timeDelta < 60 && lastLog.event_type === 'transcript_partial') {
      // Update the top entry in place instead of appending a new one
      const updated = { ...lastLog, message, timestamp: Date.now() };
      return {
        eventLogs: [updated, ...state.eventLogs.slice(1)],
      };
    }
  }

  if (eventType === 'audio_chunk' && lastLog) {
    const timeDelta = Date.now() - lastLog.timestamp;
    if (timeDelta < 60 && lastLog.event_type === 'audio_chunk') {
      // Update the top entry in place instead of appending a new one
      const updated = { ...lastLog, message, timestamp: Date.now() };
      return {
        eventLogs: [updated, ...state.eventLogs.slice(1)],
      };
    }
  }

  const now = new Date();
  const newLog: VoiceEventLog = {
    id: crypto.randomUUID(),
    event_type: eventType as any,
    timestamp: now.getTime(),
    session_id: sessionId,
    formattedTime: now.toTimeString().split(' ')[0],
    message,
    speaker,
    ...extraFields, // speaker, asr_latency, llm_latency etc for first_audio_byte
  };

  return {
    eventLogs: [newLog, ...state.eventLogs].slice(0, 200),
  };
}),

  addMessage: (role, text, isStreaming = false) => set((state) => ({
    messages: [...state.messages, { id: crypto.randomUUID(), role, text, isStreaming }]
  })),

  updateLastMessage: (text, isStreaming = false) => set((state) => {
    const newMessages = [...state.messages];
    if (newMessages.length > 0) {
      const lastIndex = newMessages.length - 1;
      newMessages[lastIndex] = { ...newMessages[lastIndex], text, isStreaming };
    }
    return { messages: newMessages };
  }),

  addMetric: (metric) => set((state) => {
    const newMetric: LatencyMetric = { ...metric };
    return { metrics: [...state.metrics, newMetric].slice(-50) }; // Limit to last 50 entries
  }),


   runSessionReplay: async () => {
  const state = get();
  if (state.isReplaying || state.eventLogs.length === 0) return;

  // eventLogs is newest-first → reverse for chronological playback
  const logsToReplay = [...state.eventLogs].reverse();
  const snapshot = [...state.eventLogs]; // save to restore after replay
  const messages = [...state.messages]; // save to restore after replay

  set({ isReplaying: true, eventLogs: [], messages: [], statusState: 'idle' });

  for (let i = 0; i < logsToReplay.length; i++) {
    const log = logsToReplay[i];
    const nextLog = logsToReplay[i + 1];

    const rawDelta = nextLog ? nextLog.timestamp - log.timestamp : 500;
    const delay = Math.min(Math.max(rawDelta, 80), 1500);

    await new Promise((resolve) => setTimeout(resolve, delay));

    set((cur) => ({
      eventLogs: [log, ...cur.eventLogs],
      statusState:
        log.event_type === 'llm_started' ? 'processing' :
        log.event_type === 'audio_chunk' || log.event_type === 'first_audio_byte' || log.event_type === 'audio_chunk_received' ? 'speaking' :
        log.event_type === 'transcript_partial' && (log as any).speaker === 'user' ? 'recording' :
        cur.statusState,
    }));

    if (log.event_type === 'transcript_partial' || log.event_type === 'transcript_final') {
      const isUser = (log as any).speaker === 'user';
      const role = isUser ? 'user' : 'assistant';
      const textToRender = (log as any).text || log.message || '';
      if (!textToRender) continue;

      set((cur) => {
        const msgs = [...cur.messages];
        const last = msgs[msgs.length - 1];

        if (last && last.role === role && log.event_type === 'transcript_partial') {
          msgs[msgs.length - 1] = { ...last, text: textToRender, isStreaming: true };
          return { messages: msgs };
        }
        if (last && last.role === role && log.event_type === 'transcript_final') {
          msgs[msgs.length - 1] = { ...last, text: textToRender, isStreaming: false };
          return { messages: msgs };
        }
        return {
          messages: [...msgs, {
            id: (log as any).id || crypto.randomUUID(),
            role,
            text: textToRender,
            isStreaming: log.event_type === 'transcript_partial',
          }],
        };
      });
    }
  }

    // Restore full eventLogs after replay so the UI isn't left empty
    set({ isReplaying: false, statusState: 'idle', eventLogs: snapshot, messages });
  },
  // Clear out session action needs to archive before wiping out data frames
  clearSession: () =>
      set({
      messages: [],
      eventLogs: [],
      metrics: [],
      failures: [],
      statusState: 'idle',
      sessionId: '',
      wsRtt: 0,
      ws:null,
      showRegistration: true
    }),
}))
);
