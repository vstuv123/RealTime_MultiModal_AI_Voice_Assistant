import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

import { RegistrationDialog } from './components/RegistrationDialog.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* ADDED: Locks the entire app interface flow behind the security handshake overlay dialog box */}
    <RegistrationDialog />
    <App />
  </StrictMode>,
)
