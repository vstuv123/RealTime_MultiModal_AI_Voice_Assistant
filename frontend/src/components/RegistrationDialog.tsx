// src/components/RegistrationDialog.tsx
import React, { useState } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { initSocket } from '../lib/socketManager';
import { User, ShieldCheck, Cpu, Sparkles, FolderKey, Mail, Key, ArrowLeft, History, PlusCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { API_BASE, WS_BASE } from '../config';

export const RegistrationDialog: React.FC = () => {
  // Navigation Mode Selector state: 'selection' | 'resume' | 'new'
  const [flowMode, setFlowMode] = useState<'selection' | 'resume' | 'new'>('selection');
  const { addMetric, updateServiceHealth } = useSessionStore();

  // Input States
  const [name, setName] = useState('Bilal');
  const [id, setId] = useState(`usr_${Math.random().toString(36).substring(2, 7)}`);
  const [email, setEmail] = useState('bilal@platform.dev');
  const [sessId, setSessId] = useState('');
  const showRegistration = useSessionStore(s => s.showRegistration);

  const generateNewSessionToken = () => {
    const randomToken = `sess_${Math.random().toString(36).substring(2, 11)}`;
    setSessId(randomToken);
    toast.success('Generated New Session token ID', {
      style: { background: '#1e293b', color: '#fff', fontSize: '12px' },
    });
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!sessId.trim()) {
      toast.error('Session Thread Identifier is required.');
      return;
    }

    const targetSession = sessId.trim();

    try {
      // Query the FastAPI session state endpoint
      const response = await fetch(`${API_BASE}/api/session/${targetSession}`);
      const data = await response.json();

      if (data.redis_error) {
        toast.error('Redis unavailable. Cannot restore session data.', {
          duration: 5000,
          style: { background: '#1e293b', color: '#fff', border: '1px solid #ef444450' }
        });
          useSessionStore.getState().addFailure({
              severity: 'error',
              service: 'redis',
              message: 'Redis unavailable during session lookup.',
              action: 'Data persistence unavailable'
          });
          return;
      }

      if (flowMode === 'resume') {
        // ── RESUME EXISTED SESSION TURN PATHWAY ──────────────────────────────
        if (data.exists) {
          useSessionStore.setState({
            username: data.username || 'Restored Operator',
            userId: data.user_id || 'usr_unknown',
            email: data.email || 'guest@platform.dev',
            sessionId: targetSession,
            messages: data.messages || [],
            eventLogs: [...(data.events || [])].reverse(),      // flip so newest is at top
          });

          let lastMetricEvent = null;
          let lastDeepgramEvent = null;

          if (data.events && data.events.length > 0) {
            for (let i = 0; i < data.events.length; i++) {
                if (data.events[i].event_type === "first_audio_byte") {
                    addMetric({
                        asr: data.events[i].asr_latency,
                        llm: data.events[i].llm_latency,
                        tts: data.events[i].tts_latency,
                        total: data.events[i].total_latency,
                        timestamp: data.events[i].formattedTime,
                    })
                    if (data.events[i].service && data.events[i].service === 'deepgram') {
                      lastDeepgramEvent = data.events[i]; // tracking it
                    }
                    lastMetricEvent = data.events[i]; // tracking it
                }
            }

            if (lastDeepgramEvent) {
                updateServiceHealth("deepgram", { latency: lastDeepgramEvent.asr_latency });
            }

            // update health only from the last first_audio_byte, not last event
            if (lastMetricEvent) {
                updateServiceHealth("groq",     { latency: lastMetricEvent.llm_latency });
                updateServiceHealth("cartesia", { latency: lastMetricEvent.tts_latency });
            }
          }
          toast.success(`Welcome back, ${data.username || 'Operator'}! Session restored.`, { icon: '🔄' });
          initSocket(`${WS_BASE}/ws/voice`);
          useSessionStore.setState({ showRegistration: false });
        } else {
          // If they entered a dead key, stop execution and give a friendly fallback notification
          toast.error('Session Identifier not found in Redis. Please generate a new pipeline.', {
            duration: 4000,
            style: { background: '#1e293b', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.15)' },
          });
        }
      } else {
        // ── CREATE NEW CONTEXT SESSION PATHWAY ────────────────────────────────
        useSessionStore.setState({
          username: name.trim(),
          userId: id.trim(),
          email: email.trim(),
          sessionId: targetSession,
          messages: [],
          eventLogs: [],
        });
        toast.success(`Initialized New Session context thread: ${targetSession}`);
        initSocket(`${WS_BASE}/ws/voice`);
        useSessionStore.setState({showRegistration: false})
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to communicate with FastAPI gateway. Check your internet conenction and try again');
    }
  };

  if (!showRegistration) return null;

  return (
    <div className="fixed inset-0 bg-[#0f172a]/95 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-[#1e293b] border border-slate-800 rounded-2xl w-full max-w-md p-8 shadow-2xl relative overflow-hidden animate-fadeIn">
        <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
          <Cpu className="w-24 h-24 text-white" />
        </div>

        {/* ── SCREEN 1: MODAL DECISION SELECTION GRID ───────────────────────── */}
        {flowMode === 'selection' && (
          <div className="text-center space-y-6">
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 bg-[#3b82f6]/10 rounded-xl border border-[#3b82f6]/20 flex items-center justify-center mb-3">
                <ShieldCheck className="w-6 h-6 text-[#3b82f6]" />
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight">Real-Time Platform Gateway</h2>
              <p className="text-xs text-slate-400 mt-1">
                Select an operational runtime sequence to activate your voice loop.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 pt-2">
              <button
                onClick={() => { setFlowMode('resume'); setSessId(''); }}
                className="flex items-center gap-4 p-4 rounded-xl border border-slate-800 bg-[#0f172a]/40 hover:bg-[#0f172a] hover:border-slate-700 transition-all text-left group cursor-pointer"
              >
                <div className="w-10 h-10 rounded-lg bg-[#aa3bff]/10 border border-[#aa3bff]/20 flex items-center justify-center group-hover:bg-[#aa3bff] group-hover:text-white transition-all text-[#aa3bff]">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">Resume Existing Session</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Enter a previous key token to sync profile and logs from Redis.
                  </p>
                </div>
              </button>

              <button
                onClick={() => { setFlowMode('new'); setSessId(''); generateNewSessionToken(); }}
                className="flex items-center gap-4 p-4 rounded-xl border border-slate-800 bg-[#0f172a]/40 hover:bg-[#0f172a] hover:border-slate-700 transition-all text-left group cursor-pointer"
              >
                <div className="w-10 h-10 rounded-lg bg-[#3b82f6]/10 border border-[#3b82f6]/20 flex items-center justify-center group-hover:bg-[#3b82f6] group-hover:text-white transition-all text-[#3b82f6]">
                  <PlusCircle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">Create Fresh Pipeline</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Register a brand new operator profile and spin up a blank history track.
                  </p>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* ── SCREEN 2: ENTRY FORMS (RESUME OR NEW) ─────────────────────────── */}
        {flowMode !== 'selection' && (
          <form onSubmit={handleRegisterSubmit} className="space-y-4">
            <div className="flex items-center gap-2 text-slate-400 mb-2">
              <button
                type="button"
                onClick={() => setFlowMode('selection')}
                className="p-1 rounded-lg hover:bg-[#0f172a] hover:text-white transition-all cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <span className="text-xs uppercase font-bold tracking-wider text-slate-500">
                {flowMode === 'resume' ? 'Resume Workspace Session' : 'Register Operator Node'}
              </span>
            </div>

            {/* Render full registration fields ONLY if setting up an entirely brand new session */}
            {flowMode === 'new' && (
              <div className="space-y-3 animate-fadeIn">
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-left">
                    <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">
                      Username
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full bg-[#0f172a] border border-slate-800 rounded-xl py-2 pl-9 pr-3 text-xs font-semibold text-white focus:outline-none focus:border-[#3b82f6]"
                        required
                      />
                    </div>
                  </div>

                  <div className="text-left">
                    <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">
                      User ID Key
                    </label>
                    <div className="relative">
                      <Key className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
                      <input
                        type="text"
                        value={id}
                        onChange={(e) => setId(e.target.value)}
                        className="w-full bg-[#0f172a] border border-slate-800 rounded-xl py-2 pl-9 pr-3 text-xs font-mono text-slate-400 focus:outline-none focus:border-[#3b82f6]"
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="text-left">
                  <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-[#0f172a] border border-slate-800 rounded-xl py-2 pl-9 pr-3 text-xs font-medium text-white focus:outline-none focus:border-[#3b82f6]"
                      required
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Session ID Entry Lane (Always visible across both modes) */}
            <div className="text-left pt-1">
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-1">
                {flowMode === 'resume' ? 'Target Session Identifier' : 'Session Identifier Key'}
              </label>
              <div className="relative">
                <FolderKey className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
                <input
                  type="text"
                  value={sessId}
                  onChange={(e) => setSessId(e.target.value)}
                  className="w-full bg-[#0f172a] border border-slate-800 rounded-xl py-2 pl-9 pr-9 text-xs font-mono text-white focus:outline-none focus:border-[#3b82f6]"
                  placeholder={flowMode === 'resume' ? 'Paste previous sess_xxxx ID...' : 'Generate custom key...'}
                  disabled={flowMode === 'new'}
                  required
                />
                {flowMode === 'new' && (
                  <button
                    type="button"
                    onClick={generateNewSessionToken}
                    className="absolute right-3 top-2 text-slate-500 hover:text-[#aa3bff] transition-colors cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4" />
                  </button>
                )}
              </div>
              <p className="text-[10px] text-slate-600 mt-1.5 leading-relaxed">
                {flowMode === 'resume'
                  ? 'Input a pre-existing session token. The platform will safely cross-reference Redis cluster memory schemas.'
                  : 'Establish a new conversation channel. Press the magic wand icon to automatically populate an authenticated unique string.'}
              </p>
            </div>

            <button
              type="submit"
              className={`w-full text-white font-bold py-3 px-4 rounded-xl shadow-lg transition-all cursor-pointer text-xs mt-6 uppercase tracking-wider ${
                flowMode === 'resume'
                  ? 'bg-[#aa3bff] hover:bg-[#aa3bff]/90 shadow-[#aa3bff]/10'
                  : 'bg-[#3b82f6] hover:bg-[#3b82f6]/90 shadow-[#3b82f6]/10'
              }`}
            >
              {flowMode === 'resume' ? 'Sync Traces & Connect Pipeline' : 'Initialize Channel & Launch'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
