// src/components/HealthPanel.tsx
import React from 'react';
import { useSessionStore } from '../store/sessionStore';
import { Activity, ShieldAlert, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { type ServiceName } from '../types/metrics';

export const HealthPanel: React.FC = () => {
  // Pull all live network telemetry variables directly from your centralized state store
  const { health, isConnected, wsRtt, asrService } = useSessionStore();
  let filteredService = 'whisper';

  if (asrService === 'deepgram') {
    filteredService = 'whisper';
  }else {
    filteredService = 'deepgram';
  }

  React.useEffect(() => {
    let isMounted = true;
    if (isMounted) {
      useSessionStore.getState().updateServiceHealth('websocket', {
        status: isConnected ? 'healthy' : 'unhealthy',
        latency: isConnected ? 1 : 0
      });
    }
    return () => { isMounted = false; };
  }, [isConnected]);

  return (
    <div className="bg-[#1e293b] border border-slate-800 rounded-2xl p-6 shadow-xl">
      <div className="flex items-center gap-2 mb-6 border-b border-slate-800/60 pb-3">
        <Activity className="w-4 h-4 text-[#3b82f6]" />
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
          Core Infrastructure Topology
        </h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {(Object.keys(health) as ServiceName[])
          .filter(key => key !== filteredService) 
          .map((key) => {
          const service = health[key];
          const isHealthy = service.status === 'healthy';
          const isWS = key === 'websocket';

          return (
            <div 
              key={key} 
              className={`p-4 rounded-xl border flex flex-col justify-between transition-all hover:scale-[1.01] ${
                isHealthy 
                  ? 'bg-[#0f172a]/40 border-slate-800/80 hover:border-slate-700' 
                  : 'bg-[#ef4444]/5 border-[#ef4444]/20 shadow-lg shadow-[#ef4444]/5'
              }`}
            >
              {/* Card Header Status Indicator */}
              <div className="flex items-start justify-between gap-2">
                <span className={`text-xs font-bold truncate ${isHealthy ? 'text-slate-200' : 'text-[#ef4444]'}`}>
                  {service.label}
                </span>
                {isHealthy ? (
                  <CheckCircle2 className="w-4 h-4 text-[#22c55e] shrink-0" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-[#ef4444] animate-pulse shrink-0" />
                )}
              </div>

              {/* Dynamic Metrics Panel Value Section */}
              <div className="my-4">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                  {isWS ? 'Network Core' : 'Latency'}
                </p>
                <div className={`text-lg font-black font-mono tracking-tight ${isHealthy ? 'text-white' : 'text-slate-500'}`}>
                  {isWS ? (
                    /* Renders authentic live Network RTT and hardware audio chunk logs stacked */
                    <div className="flex items-baseline gap-1">
                      <span>{wsRtt}</span>
                      <span className="text-[10px] font-medium text-slate-500">ms RTT</span>
                    </div>
                  ) : (
                    /* Renders cloud service processing benchmarks */
                    <div className="flex items-baseline gap-1">
                      <span>{service.latency > 0 ? `${service.latency}` : '--'}</span>
                      <span className="text-[10px] font-medium text-slate-500">ms</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Card Footer Structural Details */}
              <div className="border-t border-slate-800/60 pt-2.5 space-y-1 text-[10px] font-mono">
                <div className="flex justify-between text-slate-400">
                  <span className="text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> Check:</span>
                  <span className="text-slate-300 truncate max-w-[70px] text-right">{service.lastCheck}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Errors:</span>
                  <span className={`font-bold ${service.errorCount > 0 ? 'text-[#ef4444]' : 'text-slate-600'}`}>
                    {service.errorCount}
                  </span>
                </div>
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
};
