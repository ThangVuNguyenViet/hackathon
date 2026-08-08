import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

console.log('PVCFC App loaded:', typeof App);

const rootEl = document.getElementById('root');
if (rootEl) {
  try {
    ReactDOM.createRoot(rootEl).render(<App />);
  } catch (e) {
    console.error('Render error:', e);
    rootEl.innerHTML = `<div style="padding: 20px; color: red;">Render error: ${String(e)}</div>`;
  }
}
