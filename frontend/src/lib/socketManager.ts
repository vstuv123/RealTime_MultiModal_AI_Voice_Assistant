import toast from 'react-hot-toast';
import { useSessionStore } from '../store/sessionStore';
import { type ServerWebSocketPayload } from '../types/events';
import type { ServiceName } from '../types/metrics';

let audioContext: AudioContext | null = null;
let gainNode: GainNode | null = null;
let audioQueue: Float32Array[] = [];
let isPlaying = false;
let wsInstance: WebSocket | null = null;
let pingInterval: ReturnType<typeof setInterval> | null = null; // Global

const updateUserOrAssistantMessage = (text: string, role: 'user' | 'assistant', eventType: 'transcript_partial' | 'transcript_final', isStreaming = true) => {
    const { messages, updateLastMessage, addMessage } = useSessionStore.getState();
    const lastMsg = messages[messages.length - 1];
    
    // when trancript final comes already of same role but then transcipt partial gets gernrate, then ignore it 
    if (lastMsg && lastMsg.role === role && eventType === 'transcript_partial' && !lastMsg.isStreaming) {
        return;
    }
    else if (lastMsg && lastMsg.role !== role && lastMsg.isStreaming) {
        return;
    }
    else if (lastMsg && lastMsg.role === role && lastMsg.isStreaming) {
        updateLastMessage(text, isStreaming);
    } else {
        addMessage(role, text, isStreaming);
    }
};

const playNextQueuedBuffer = () => {
    if (audioQueue.length === 0 || !audioContext || !gainNode) {
        isPlaying = false;
        return;
    }
    isPlaying = true;
    const chunk = audioQueue.shift()!;
    const buffer = audioContext.createBuffer(1, chunk.length, 16000);
    buffer.getChannelData(0).set(chunk);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(gainNode);
    source.onended = () => playNextQueuedBuffer();
    source.start(0);
};

const handleIncomingAudioChunk = (base64Chunk: string) => {
    const binary = window.atob(base64Chunk);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
    audioQueue.push(float32);
    if (!isPlaying) playNextQueuedBuffer();
};

export const initSocket = (url: string) => {
    // already connected — don't reconnect
    if (wsInstance && wsInstance.readyState === WebSocket.OPEN) return;

    const { setConnected, addLog, addMetric, setStatusState, setWs } = useSessionStore.getState();
    const sessionId = useSessionStore.getState().sessionId;

    // Append query string variables onto your connection handshakes!
    // Pull the verified user parameters typed by the user directly out of store state definitions
    const username = useSessionStore.getState().username || "name";
    const userId = useSessionStore.getState().userId || "usr_fallback";
    const email = useSessionStore.getState().email || "name@gmail.com";
    const authenticatedUrl = `${url}?username=${username}&user_id=${userId}&email=${email}&session_id=${sessionId}`;

    // init audio
    if (!audioContext) {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        gainNode = audioContext.createGain();
        const isMuted = useSessionStore.getState().isMuted;
        gainNode.gain.setValueAtTime(isMuted ? 0 : 1, audioContext.currentTime);
        gainNode.connect(audioContext.destination);

        // subscribe to mute changes
        useSessionStore.subscribe(
            (state) => state.isMuted,
            (isMuted: boolean) => {
                if (gainNode && audioContext) {
                    gainNode.gain.setValueAtTime(isMuted ? 0 : 1, audioContext.currentTime);
                }
            }
        );
    }

    const ws = new WebSocket(authenticatedUrl);
    wsInstance = ws;
    setWs(ws);

    // Assigned directly into your global tracker reference
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'ping',
          startTime: Date.now()
        }));
      }
    }, 5000); // Maintained ultra-fresh 5-second latency tracking checks

    ws.onopen = () => {
        setConnected(true);
        addLog('websocket', 'Pipeline socket linked.', sessionId, '');
    };

    ws.onclose = () => {
        setConnected(false);
        wsInstance = null;
        setWs(null);

        // Wipe the background ping thread immediately on disconnect to prevent floating interval leaks
        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
        }

        addLog('websocket', 'Pipeline socket disconnected.', sessionId, '');
    };

    ws.onmessage = async (e) => {

        // Intercept the real-time Pong payload structures before they get logged or routed
        try {
            const parsed = JSON.parse(e.data);
            if (parsed.type === 'pong' && parsed.startTime) {
                const currentRtt = Date.now() - parsed.startTime;
                // Safely update your new wsRtt parameter inside the global Zustand store
                useSessionStore.getState().setWsRtt(currentRtt);
                return; // Terminate execution early so the metrics frame doesn't pollute the raw event bus panel!
            }
        } catch {
            // Arriving frame is binary audio bytes or voice assistant textual event data, pass down cleanly
        }

        const data: ServerWebSocketPayload = JSON.parse(e.data);

        if (data.event_type && data.event_type !== 'failure_event') {
            addLog(data.event_type, data.message || '', data.session_id, data.speaker || '');
        }

        switch (data.event_type) {
            case 'transcript_partial':
                if (data.speaker === 'user') {
                    setStatusState('recording');
                    updateUserOrAssistantMessage(data.text || '', 'user', 'transcript_partial');
                } else {
                    const currentStatus = useSessionStore.getState().statusState;
                    if (currentStatus !== 'speaking') setStatusState('processing');
                    updateUserOrAssistantMessage(data.text || '', 'assistant', 'transcript_partial');
                }
                break;

            case 'transcript_final':
                if (data.speaker === 'user') {
                    updateUserOrAssistantMessage(data.text || '', 'user', 'transcript_final',  false);
                } else {
                    updateUserOrAssistantMessage(data.text || '', 'assistant', 'transcript_final', false);
                }
                break;

            case 'llm_started':
                setStatusState('processing');
                break;

            case 'first_token':
                setStatusState("processing")
                if (data.asr_latency && data.llm_latency) {
                    useSessionStore.getState().updateServiceHealth('deepgram', { status: 'healthy', latency: data.asr_latency });
                    useSessionStore.getState().updateServiceHealth('groq', { status: 'healthy', latency: data.llm_latency });
                }
                break;

            case 'first_audio_byte':
                // Generates "13:15:30" format directly in JavaScript
                const formatted_time = new Date().toLocaleTimeString('en-US', { hour12: false });

                if (data.chunk) {
                    if (data.service && data.service === 'whisper') {
                        useSessionStore.getState().updateServiceHealth('whisper', { latency: data.asr_latency })
                    }
                    setStatusState('speaking');
                    handleIncomingAudioChunk(data.chunk);
                    if (data.tts_latency) {
                        addMetric({
                            asr: data.asr_latency || 95,
                            llm: data.llm_latency || 120,
                            tts: data.tts_latency,
                            total: data.total_latency || 400,
                            timestamp: formatted_time,
                        });
                        useSessionStore.getState().updateServiceHealth('cartesia', { status: 'healthy', latency: data.tts_latency });
                    }
                }
                break;

            case 'audio_chunk':
                if (data.chunk) {
                    setStatusState('speaking');
                    handleIncomingAudioChunk(data.chunk);
                }
                break;

            case 'response_completed':
                setStatusState('idle');
                break;
            
            case 'assistant_error':
                updateUserOrAssistantMessage(data.text || '', 'assistant', 'transcript_final', false);
                setStatusState('idle')
                break;

            case 'redis_health':
                useSessionStore.getState().updateServiceHealth('redis', { latency: data.redis_latency, status: 'healthy' });
                break;
            
            case 'failure_event':
                // Backend sends this for errors/warnings/recoveries with full context
                useSessionStore.getState().addFailure({
                  severity: data.severity,           // 'error' | 'warning' | 'recovery'
                  service:  data.service,            // 'deepgram' | 'groq' | 'cartesia' | 'redis'
                  message:  data.message,
                  action:   data.action,             // e.g. "Retry Attempt 1/3" | "Fallback → Whisper"
                  requestId: data.request_id,
                });
                // Switch ASR service based on failure events
                if (data.service === 'whisper' && data.severity === 'recovery') {
                    // whisper recovered but we still use whisper (deepgram still down)
                    useSessionStore.getState().setAsrService('whisper');
                } else if (data.service === 'deepgram') {
                    if (data.severity === 'recovery') {
                        useSessionStore.getState().setAsrService('deepgram');
                        useSessionStore.getState().updateServiceHealth('deepgram', { status: 'healthy' })
                    } else if (data.severity === 'error' && data.action?.includes('Whisper')) {
                        // deepgram failed, whisper activated
                        useSessionStore.getState().setAsrService('whisper');
                    }
                }
                break;
            
            case 'tts_unavailable':
                // Cartesia failed — show text bubble, no audio
                useSessionStore.getState().addFailure({
                  severity: 'error',
                  service:  'cartesia',
                  message:  'Voice output unavailable.',
                  action:   'Fallback → Text Output',
                });
        
                toast.error('Voice service unavailable. Audio output suspended.', {
                    duration: 5000,
                    style: { background: '#1e293b', color: '#fff', border: '1px solid #ef444450' },
                });
                break;
            
            case 'error':
                const lowerMsg = (data.message || '').toLowerCase();
 
                // Determine which service failed
                let service : ServiceName = 'websocket';
                if  (lowerMsg.includes('deepgram') || lowerMsg.includes('asr'))  service = 'deepgram';
                else if (lowerMsg.includes('groq')    || lowerMsg.includes('llm') || lowerMsg.includes('engine')) service = 'groq';
                else if (lowerMsg.includes('cartesia')|| lowerMsg.includes('tts'))     service = 'cartesia';
                else if (lowerMsg.includes('redis')   || lowerMsg.includes('cache'))   service = 'redis';
                else if (lowerMsg.includes('whisper'))  service = 'whisper';
 
                // Increment health error counter (existing logic)
                useSessionStore.getState().incrementServiceError(service === 'websocket' ? 'websocket' : service);
 
                // NEW: also push to failure panel
                useSessionStore.getState().addFailure({
                  severity: 'error',
                  service,
                  message:  data.message || 'Unknown error',
                  action:   data.action,   // backend can optionally send action field
                });
 
                break;
        }
    };
};

// ✅ use these instead of wsRef methods
export const sendAudioBytes = (pcmBuffer: ArrayBuffer) => {
    if (wsInstance && wsInstance.readyState === WebSocket.OPEN) {
        wsInstance.send(pcmBuffer);
    }
};

export const sendControlMessage = (payload: object) => {
    if (wsInstance && wsInstance.readyState === WebSocket.OPEN) {
        wsInstance.send(JSON.stringify(payload));
    }
};