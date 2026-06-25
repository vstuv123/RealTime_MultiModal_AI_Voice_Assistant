import React from 'react';
import { useSessionStore } from '../store/sessionStore';
import { VoiceControls } from '../components/VoiceControls';
import { ChatPanel } from '../components/ChatPanel';
import { MetricsPanel } from '../components/MetricsPanel';
import { HealthPanel } from '../components/HealthPanel';
import { EventLog } from '../components/EventLog';
import { ReplayPanel } from '../components/ReplayPanel';
import { FailurePanel } from '../components/FailurePanel';

export const Dashboard: React.FC = () => {
  const { activeTab } = useSessionStore();

  return (
    <>
      {activeTab === 'interaction' ? (
        /* Workspace Tab: Locked layout, zero main page scrollbar */
        <main className="flex-1 p-4 sm:p-6 bg-[#0f172a] overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 h-full items-stretch">
            <div className="md:col-span-1 h-full">
              <VoiceControls />
            </div>
            <div className="md:col-span-3 h-full">
              <ChatPanel />
            </div>
          </div>
        </main>
      ) : (
        /* Analytics Tab: Fluid scrolling workspace container */
        <main className="flex-1 p-4 sm:p-6 bg-[#0f172a] overflow-y-auto custom-scroll animate-fadeIn">
          <div className="flex flex-col gap-6 max-w-7xl mx-auto pb-12">
            <HealthPanel />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              <div className="grid grid-cols-1 gap-6 lg:col-span-2">
                <MetricsPanel />
                <FailurePanel />
              </div>
              
              {/* This column space now elegantly stacks Event Bus and Time Travel Debugger components together! */}
              <div className="lg:col-span-1 flex flex-col gap-6">
                <EventLog />
                <ReplayPanel />
              </div>
            </div>
          </div>
        </main>
      )}
    </>
  );
};
