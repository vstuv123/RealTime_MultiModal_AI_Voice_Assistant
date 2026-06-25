// src/components/VoiceControls.tsx
import React from 'react';
import { Mic, Square, Volume2, VolumeX, Trash2 } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';
import { useSocket } from '../hooks/useSocket';
import { useMicrophone } from '../hooks/useMicrophone';
import { WS_BASE } from '../config';

export const VoiceControls: React.FC = () => {
  // Bind your centralized WS listener engine
  const { sendAudioBytes, sendControlMessage } = useSocket(`${WS_BASE}/ws/voice`);
  
  // Wire chunk emitter inside native hardware mic processor
  const { startRecording, stopRecording } = useMicrophone(sendAudioBytes, sendControlMessage);

  const { isRecording, statusState, clearSession, isMuted, setIsMuted, isReplaying } = useSessionStore();

  const handleToggleRecording = () => {
    if (isReplaying) return; // Prevent mic usage during debugger replay simulation loops
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className="bg-[#1e293b] rounded-2xl border border-slate-800 p-6 flex flex-col gap-6 shadow-2xl h-full">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Voice Control Core</h3>
      
      <div className="flex flex-col gap-3">
        <button
          disabled={isReplaying}
          onClick={handleToggleRecording}
          className={`w-full flex items-center justify-center gap-3 py-4 px-6 rounded-xl font-bold transition-all shadow-lg cursor-pointer transform active:scale-[0.98] ${
            isReplaying ? 'bg-slate-800 text-slate-600 border border-slate-700/40 cursor-not-allowed' :
            isRecording 
              ? 'bg-[#ef4444] text-white hover:bg-[#ef4444]/90' 
              : 'bg-[#3b82f6] text-white hover:bg-[#3b82f6]/90'
          }`}
        >
          {isRecording ? <Square className="w-5 h-5 fill-white" /> : <Mic className="w-5 h-5" />}
          {isRecording ? 'Stop Engine' : 'Stream Voice'}
        </button>
          {/* Bind the onclick action to fire the Zustand function and render corresponding style adjustments */}
        <button
          onClick={() => setIsMuted(!isMuted)}
          className={`w-full flex items-center justify-center gap-3 py-3 px-6 rounded-xl font-semibold transition-all border cursor-pointer ${
            isMuted 
              ? 'bg-[#ef4444]/10 border-[#ef4444]/30 text-[#ef4444] hover:bg-[#ef4444]/20' 
              : 'bg-[#0f172a] border-slate-700 text-slate-300 hover:border-slate-600'
          }`}
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          {isMuted ? 'Unmute Speaker' : 'Mute Playback'}
        </button>
      </div>

      <div className="border-t border-slate-800/80 pt-6">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block mb-3">Pipeline Status</span>
        <div className="grid grid-cols-3 gap-2">
          {(['recording', 'processing', 'speaking'] as const).map((state) => {
            const active = statusState === state;
            const colors = {
              recording: 'bg-[#ef4444]',
              processing: 'bg-[#3b82f6]',
              speaking: 'bg-[#22c55e]',
            };
            return (
              <div 
                key={state}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                  active ? `bg-slate-800 border-slate-600 font-bold` : 'bg-[#0f172a]/40 border-slate-800/50 text-slate-600'
                }`}
              >
                <div className={`w-2 h-2 rounded-full mb-1.5 ${active ? colors[state] : 'bg-slate-800'}`} />
                <span className={`text-[10px] uppercase tracking-wider ${active ? 'text-white' : 'text-slate-600'}`}>
                  {state}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <button
        onClick={clearSession}
        className="mt-auto w-full flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-medium text-slate-400 hover:text-[#ef4444] bg-[#0f172a]/30 border border-slate-800/80 rounded-xl hover:border-[#ef4444]/30 transition-all cursor-pointer"
      >
        <Trash2 className="w-3.5 h-3.5" /> Wipe Pipeline Session
      </button>
    </div>
  );
};
