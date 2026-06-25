// src/components/FailurePanel.tsx
import React, { useState } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { AlertTriangle, XCircle, CheckCircle2, Trash2, ShieldAlert } from 'lucide-react';
import { type FailureSeverity } from '../types/failures'; // adjust import path

const SEVERITY_CONFIG: Record<FailureSeverity, {
  label: string;
  color: string;
  bg: string;
  border: string;
  icon: React.FC<{ className?: string }>;
}> = {
  error: {
    label: 'ERROR',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    icon: ({ className }) => <XCircle className={className} />,
  },
  warning: {
    label: 'WARNING',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    icon: ({ className }) => <AlertTriangle className={className} />,
  },
  recovery: {
    label: 'RECOVERY',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    icon: ({ className }) => <CheckCircle2 className={className} />,
  },
};

const SERVICE_COLORS: Record<string, string> = {
  deepgram:  'text-sky-400',
  groq:      'text-violet-400',
  cartesia:  'text-pink-400',
  redis:     'text-orange-400',
  websocket: 'text-slate-400',
  whisper:   'text-cyan-400',
};

export const FailurePanel: React.FC = () => {
  const failures    = useSessionStore((s) => s.failures);
  const clearFailures = useSessionStore((s) => s.clearFailures);

  const [filter, setFilter] = useState<'all' | FailureSeverity>('all');

  const filtered = filter === 'all' ? failures : failures.filter((f) => f.severity === filter);

  const counts = {
    error:    failures.filter((f) => f.severity === 'error').length,
    warning:  failures.filter((f) => f.severity === 'warning').length,
    recovery: failures.filter((f) => f.severity === 'recovery').length,
  };

  return (
    <div className="bg-[#1e293b] border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-red-400" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
            Failure Telemetry
          </h3>
          {failures.length > 0 && (
            <span className="text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/20 rounded-full px-2 py-0.5">
              {counts.error} error{counts.error !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Summary badges */}
          <div className="hidden sm:flex items-center gap-1.5 mr-2">
            <span className="text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg px-2 py-1">
              🔴 {counts.error}
            </span>
            <span className="text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-lg px-2 py-1">
              🟡 {counts.warning}
            </span>
            <span className="text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg px-2 py-1">
              🟢 {counts.recovery}
            </span>
          </div>

          {/* Filter */}
          <div className="flex items-center gap-1 bg-[#0f172a] rounded-xl p-1 border border-slate-800">
            {(['all', 'error', 'warning', 'recovery'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  filter === f
                    ? 'bg-[#1e293b] text-white shadow'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Clear */}
          {failures.length > 0 && (
            <button
              onClick={clearFailures}
              className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
              title="Clear all failures"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── List ── */}
      <div className="max-h-80 overflow-y-auto custom-scroll divide-y divide-slate-800/60">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-600 gap-2">
            <CheckCircle2 className="w-8 h-8 opacity-30" />
            <p className="text-xs font-mono">
              {filter === 'all' ? 'No failures recorded.' : `No ${filter}s recorded.`}
            </p>
          </div>
        ) : (
          filtered.map((failure) => {
            const cfg = SEVERITY_CONFIG[failure.severity];
            const Icon = cfg.icon;
            const serviceColor = SERVICE_COLORS[failure.service] || 'text-slate-400';

            return (
              <div
                key={failure.id}
                className={`flex gap-3 px-5 py-3.5 ${cfg.bg} hover:brightness-110 transition-all`}
              >
                {/* Icon */}
                <div className="mt-0.5 shrink-0">
                  <Icon className={`w-4 h-4 ${cfg.color}`} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-mono text-slate-500">{failure.timestamp}</span>
                    <span className={`text-[10px] font-black uppercase tracking-widest ${cfg.color} border ${cfg.border} rounded px-1.5 py-0.5`}>
                      {cfg.label}
                    </span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${serviceColor}`}>
                      {failure.service}
                    </span>
                    {failure.requestId && (
                      <span className="text-[10px] font-mono text-slate-600">
                        #{failure.requestId}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-300 font-medium mt-1 leading-relaxed">
                    {failure.message}
                  </p>

                  {failure.action && (
                    <div className="mt-1.5 inline-flex items-center gap-1.5 bg-[#0f172a]/60 border border-slate-700/50 rounded-lg px-2.5 py-1">
                      <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Action:</span>
                      <span className="text-[10px] font-mono text-slate-300">{failure.action}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
