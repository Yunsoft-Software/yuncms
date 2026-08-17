import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { DialogProvider } from './components/DialogProvider.jsx';
import { StudioSettingsProvider } from './contexts/StudioSettingsContext.jsx';
import './styles.css';
import './ui-improvements.css';
import './usability-pass.css';
import './appearance.css';
import './roles-polish.css';
import './media-preview.css';
import './field-builder.css';
import './visual-fixes.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StudioSettingsProvider>
      <DialogProvider>
        <App />
      </DialogProvider>
    </StudioSettingsProvider>
  </StrictMode>,
);
