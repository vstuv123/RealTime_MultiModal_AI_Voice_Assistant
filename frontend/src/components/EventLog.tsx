import React from 'react';
import { useSessionStore } from '../store/sessionStore';
import { Terminal } from 'lucide-react';

export const EventLog: React.FC = () => {
  const { eventLogs } = useSessionStore();

  const getEventStyles = (type: string) => {
    if (type.includes('error')) return 'text-[#ef4444] bg-[#ef4444]/5 border-[#ef4444]/10';
    if (type.includes('final') || type.includes('completed')) return 'text-[#22c55e]';
    if (type.includes('started') || type.includes('first')) return 'text-[#3b82f6]';
    return 'text-slate-400';
  };

  return (
    <div className="bg-[#1e293b] border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col h-[400px]">
      <div className="flex items-center gap-2 mb-4 border-b border-slate-800/60 pb-3">
        <Terminal className="w-4 h-4 text-slate-400" />
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Live Telemetry Event Bus</h3>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1.5 font-mono text-xs scrollbar-thin scrollbar-thumb-slate-800">
        {eventLogs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-600 italic">
            Socket idling. Pipe voice events to view orchestration loops...
          </div>
        ) : (
          eventLogs.map((log) => (
            <div 
              key={log.id} 
              className={`p-2 rounded-lg border border-transparent hover:border-slate-800 flex items-start gap-3 transition-colors ${getEventStyles(log.event_type)}`}
            >
              <span className="text-slate-500 shrink-0 font-medium">[{log.formattedTime}]</span>
              <span className="bg-[#0f172a] px-1.5 py-0.5 rounded text-[10px] uppercase font-bold border border-slate-800 tracking-wider shrink-0">
                {log.event_type.replace(/_/g, ' ')}
              </span>
              <span className="text-slate-300 truncate">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
