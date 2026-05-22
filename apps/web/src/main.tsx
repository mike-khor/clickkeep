import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element missing');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Only register in prod — in dev the SW would serve stale bundles and break HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration failures are non-fatal; the app still works online.
    });
  });
}
