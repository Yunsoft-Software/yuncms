import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { StudioNextFrame } from './components/AppRail.jsx';
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
import './navigation-v2.css';
import './data-model-v2.css';
import './data-model-v2-interactions.css';
import './asset-picker.css';
import './routed-pages.css';
import './mobile-responsive.css';
import './navigation-model.css';
import './ai.css';
import './mcp.css';
import './content-density.css';
import './studio-next.css';
import './content-workbench-next.css';
import './files-next.css';
import './data-model-next.css';
import './access-next.css';
import './ai-next.css';

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
