import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';

const mode = new URLSearchParams(window.location.search).get('mode');

if (mode === 'voice-overlay') {
  document.documentElement.dataset.hyperOverlay = 'true';
  const HyperVoiceAssistantApp = lazy(() =>
    import('./features/hyper-voice/assistant/HyperVoiceAssistantApp').then((module) => ({
      default: module.HyperVoiceAssistantApp,
    })),
  );
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Suspense fallback={null}>
        <HyperVoiceAssistantApp />
      </Suspense>
    </StrictMode>,
  );
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  if (Reflect.get(window, '__HYPER_HARNESS__')) {
    void import('./features/hyper-database/HyperDatabaseHarness').then((module) =>
      module.installHyperDatabaseHarness(),
    );
  }
}
