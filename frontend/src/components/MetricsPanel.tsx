import React from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useSessionStore } from '../store/sessionStore';
import { Zap, Clock, ShieldCheck, Cpu } from 'lucide-react';

export const MetricsPanel: React.FC = () => {
  const { metrics } = useSessionStore();
  
  // Get latest telemetry point
  const current = metrics[metrics.length - 1] || { asr: 0, llm: 0, tts: 0, total: 0 };

  const telemetryCards = [
    { title: 'ASR latency', val: current.asr, color: 'text-amber-400', border: 'border-amber-500/20', icon: Clock },
    { title: 'LLM Latency', val: current.llm, color: 'text-[#3b82f6]', border: 'border-[#3b82f6]/20', icon: Cpu },
    { title: 'TTS Latency', val: current.tts, color: 'text-[#22c55e]', border: 'border-[#22c55e]/20', icon: Zap },
    { title: 'Total Loop', val: current.total, color: 'text-purple-400', border: 'border-purple-500/20', icon: ShieldCheck },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {telemetryCards.map((card, idx) => (
          <div key={idx} className={`bg-[#1e293b] border ${card.border} rounded-2xl p-5 shadow-lg relative overflow-hidden`}>
            <div className="absolute right-3 top-3 opacity-10">
              <card.icon className="w-12 h-12 text-white" />
            </div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{card.title}</p>
            <p className={`text-2xl font-black mt-2 font-mono ${card.color}`}>
              {card.val} <span className="text-xs font-medium text-slate-500">ms</span>
            </p>
          </div>
        ))}
      </div>

      <div className="bg-[#1e293b] border border-slate-800 rounded-2xl p-6 shadow-xl">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-6">Realtime Operational Trends</h3>
        <div className="h-64 w-full">
          {metrics.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm font-mono">
              Waiting for stream cycles to initialize graphs...
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metrics} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorAsr" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#fbbf24" stopOpacity={0.2}/><stop offset="95%" stopColor="#fbbf24" stopOpacity={0}/></linearGradient>
                  <linearGradient id="colorLlm" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient>
                  <linearGradient id="colorTts" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.2}/><stop offset="95%" stopColor="#22c55e" stopOpacity={0}/></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis dataKey="timestamp" stroke="#64748b" fontSize={10} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={10} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', color: '#fff' }} />
                <Area type="monotone" dataKey="asr" name="ASR" stroke="#fbbf24" fillOpacity={1} fill="url(#colorAsr)" strokeWidth={2} />
                <Area type="monotone" dataKey="llm" name="LLM" stroke="#3b82f6" fillOpacity={1} fill="url(#colorLlm)" strokeWidth={2} />
                <Area type="monotone" dataKey="tts" name="TTS" stroke="#22c55e" fillOpacity={1} fill="url(#colorTts)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
};
