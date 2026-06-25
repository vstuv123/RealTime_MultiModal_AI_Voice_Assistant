import { useEffect } from 'react';
import { Header } from './components/Header';
import { Dashboard } from './pages/Dashboard';
import toast, { Toaster } from 'react-hot-toast';

export default function App() {

  useEffect(() => {
    // Notify the developer visually that the UI container wrapper has mounted safely
    toast.success('Realtime Event Engine Ready', {
      style: { 
        background: '#1e293b', 
        color: '#fff', 
        border: '1px solid rgba(59, 130, 246, 0.15)' 
      }
    });
  }, []);

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 flex flex-col antialiased">
      <Toaster position="top-right" />
      <Header />
      <Dashboard />
    </div>
  );
}

