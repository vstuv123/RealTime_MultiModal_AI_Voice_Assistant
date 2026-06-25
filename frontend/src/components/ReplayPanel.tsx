// src/components/ReplayPanel.tsx
import React from 'react';
import { useSessionStore } from '../store/sessionStore';
import { Play, History } from 'lucide-react';

export const ReplayPanel: React.FC = () => {
  const { runSessionReplay, isReplaying, eventLogs } = useSessionStore();

  return (
    <div className="bg-[#1e293b] border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
      <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-[#aa3bff]" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Time Travel Debugger</h3>
        </div>
        {isReplaying && (
          <span className="text-[10px] bg-[#aa3bff]/20 border border-[#aa3bff]/40 text-[#aa3bff] font-black px-2 py-0.5 rounded animate-pulse tracking-widest uppercase">
            Executing Replay
          </span>
        )}
      </div>

      <div className="my-6 text-left">
        <p className="text-xs text-slate-400 leading-relaxed">
          Simulate and review the current pipeline orchestration data stream. 
          Re-runs all <span className="font-mono font-bold text-[#aa3bff]">{eventLogs.length}</span> parsed network logs sequentially.
        </p>
      </div>

      <button
        disabled={isReplaying || eventLogs.length === 0}
        onClick={() => runSessionReplay()}
        className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm shadow-lg transition-all border cursor-pointer ${
          isReplaying || eventLogs.length === 0
            ? 'border-slate-800 bg-slate-900/40 text-slate-600 cursor-not-allowed' 
            : 'bg-[#aa3bff]/10 border-[#aa3bff]/20 text-[#aa3bff] hover:bg-[#aa3bff] hover:text-white shadow-[#aa3bff]/5'
        }`}
      >
        <Play className="w-4 h-4 fill-current" />
        {isReplaying ? 'Running Trace Analysis...' : 'Replay Current Session Link'}
      </button>
    </div>
  );
};

