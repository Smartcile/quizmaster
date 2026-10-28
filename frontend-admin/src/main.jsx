import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/admin.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Installable admin app (phone-friendly paper marking). Only in the production
// build so the Vite dev server isn't shadowed by a stale service worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
