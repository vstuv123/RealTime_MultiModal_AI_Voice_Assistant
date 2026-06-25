import React from 'react';
import { Activity, Cpu, Mic, Radio, BarChart3, MessageSquare } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';

export const Header: React.FC = () => {
  const { isConnected, sessionId, activeTab, setActiveTab } = useSessionStore();

  return (
    <header className="bg-[#1e293b] border-b border-[#3b82f6]/20 px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 shadow-xl">
      <div className="flex items-center gap-3">
        <Radio className={`w-6 h-6 ${isConnected ? 'text-[#22c55e] animate-pulse' : 'text-[#ef4444]'}`} />
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Multimodal Realtime Voice Assistant</h1>
          <p className="text-xs text-slate-400">ID: <span className="font-mono text-[#3b82f6]">{sessionId}</span></p>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-[#0f172a] p-1 rounded-lg border border-slate-700">
        <button
          onClick={() => setActiveTab('interaction')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeTab === 'interaction' ? 'bg-[#3b82f6] text-white shadow-lg' : 'text-slate-400 hover:text-white'
          }`}
        >
          <MessageSquare className="w-4 h-4" /> Workspace
        </button>
        <button
          onClick={() => setActiveTab('analytics')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            activeTab === 'analytics' ? 'bg-[#3b82f6] text-white shadow-lg' : 'text-slate-400 hover:text-white'
          }`}
        >
          <BarChart3 className="w-4 h-4" /> Analytics Engine
        </button>
      </div>

      <div className="flex items-center gap-4 bg-[#0f172a]/80 px-4 py-2 rounded-xl border border-slate-800">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-[#22c55e]' : 'bg-[#ef4444]'}`} />
          <span className="text-xs font-semibold text-slate-300">{isConnected ? 'CONNECTED' : 'DISCONNECTED'}</span>
        </div>
        <div className="h-4 w-px bg-slate-700" />
        <div className="flex gap-3 text-slate-400">
          <Activity className="w-4 h-4 hover:text-[#3b82f6] cursor-pointer transition-colors" />
          <Cpu className="w-4 h-4 hover:text-[#3b82f6] cursor-pointer transition-colors" />
          <Mic className="w-4 h-4 hover:text-[#3b82f6] cursor-pointer transition-colors" />
        </div>
      </div>
    </header>
  );
};
