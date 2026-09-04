import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { DialogProvider, StudioNextFrame } from './components/index.js';
import { StudioSettingsProvider } from './contexts/StudioSettingsContext.jsx';
import './studio.css';

if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StudioSettingsProvider>
      <StudioNextFrame>
        <DialogProvider>
          <App />
        </DialogProvider>
      </StudioNextFrame>
    </StudioSettingsProvider>
  </StrictMode>,
);
