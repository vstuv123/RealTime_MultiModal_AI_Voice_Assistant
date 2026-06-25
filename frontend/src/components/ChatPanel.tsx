import React, { useEffect, useRef } from 'react';
import { Sparkles, AudioLines } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';

export const ChatPanel: React.FC = () => {
  const { messages, statusState } = useSessionStore();
  const containerEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, statusState]);

  return (
    <div className="bg-[#1e293b] rounded-2xl border border-slate-800 flex flex-col shadow-2xl h-[calc(100vh-140px)]">
      <div className="px-6 py-4 border-b border-slate-800/60 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#3b82f6]" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Live Voice Streams</h3>
        </div>
        {statusState === 'processing' && (
          <div className="flex items-center gap-1.5 text-xs text-[#3b82f6]">
            <AudioLines className="w-4 h-4 animate-pulse" /> Context Synthesis...
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin scrollbar-thumb-slate-800">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 bg-[#0f172a] rounded-2xl border border-slate-800 flex items-center justify-center mb-4 shadow-inner">
              <AudioLines className="w-8 h-8 text-slate-600" />
            </div>
            <p className="text-slate-400 font-medium">Pipeline Engaged & Empty</p>
            <p className="text-xs text-slate-500 max-w-xs mt-1">Activate your voice stream or microphone to process realtime inference inputs.</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col max-w-[85%] rounded-2xl p-4 shadow-md ${
                msg.role === 'user'
                  ? 'bg-[#3b82f6]/10 border border-[#3b82f6]/20 ml-auto text-slate-100 rounded-tr-none'
                  : 'bg-[#0f172a] border border-slate-800 text-slate-200 mr-auto rounded-tl-none'
              }`}
            >
              <span className={`text-[10px] uppercase font-bold tracking-widest mb-1 ${
                msg.role === 'user' ? 'text-[#3b82f6]' : 'text-[#22c55e]'
              }`}>
                {msg.role === 'user' ? 'User Stream' : 'Assistant Node'}
              </span>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
              {msg.isStreaming && (
                <span className="w-1.5 h-3.5 ml-1 bg-[#22c55e] inline-block animate-pulse align-middle" />
              )}
            </div>
          ))
        )}
        <div ref={containerEndRef} />
      </div>
    </div>
  );
};
