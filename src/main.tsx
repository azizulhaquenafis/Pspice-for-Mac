import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/theme.css';
import { startAutosave, useStore } from './state/store';
import { recoverAutosave, initEngine } from './state/actions';

createRoot(document.getElementById('root')!).render(<App />);
setTimeout(() => { recoverAutosave(); startAutosave(); initEngine(); }, 100);

// Dev-only automation hook (browser tests / future AI tool layer). Not present in production builds.
if (import.meta.env.DEV) (window as any).__openspice = { useStore };
