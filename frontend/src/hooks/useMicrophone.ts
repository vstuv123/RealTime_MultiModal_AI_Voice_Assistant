// src/hooks/useMicrophone.ts
import { useRef } from 'react';
import { useSessionStore } from '../store/sessionStore';

export const useMicrophone = (onAudioChunk: (buffer: ArrayBuffer) => void, onControlMessage: (payload: object) => void) => {
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  
  const { setRecording, setStatusState, addLog, sessionId } = useSessionStore();

  const startRecording = async () => {
    try {
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new AudioContext({ sampleRate: 16000 }); // Deepgram prefers a native 16kHz layout
      
      const source = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
      // Slicing windows to preserve network stream throughput
      processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);

      source.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);

      processorRef.current.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        // Convert the input Float32 arrays directly to standard Int16 format bytes
        const pcmBuffer = downsampleToFloat32ToInt16(inputData);
        onAudioChunk(pcmBuffer);
      };

      setRecording(true);
      setStatusState('recording');
      addLog('audio_chunk_received', 'Microphone capture active.', sessionId, '');
    } catch (err) {
      console.error('Failed to mount platform mic capturing device:', err);
    }
  };

  const stopRecording = () => {
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    processorRef.current?.disconnect();
    audioContextRef.current?.close();

    // Execute the passed function to tell the Python backend the user clicked stop
    onControlMessage({ type: 'stop_recording' });
    
    setRecording(false);
    setStatusState('idle');
    addLog('audio_chunk_received', 'Microphone connection terminated.', sessionId, '');
  };

  const downsampleToFloat32ToInt16 = (buffer: Float32Array) => {
    let l = buffer.length;
    const buf = new Int16Array(l);
    while (l--) {
      buf[l] = Math.min(1, buffer[l]) * 0x7FFF;
    }
    return buf.buffer;
  };

  return { startRecording, stopRecording };
};
