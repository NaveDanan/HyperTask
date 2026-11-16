import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (Reflect.get(window, '__HYPER_HARNESS__')) {
  void import('./features/hyper-database/HyperDatabaseHarness').then(module => module.installHyperDatabaseHarness());
}
