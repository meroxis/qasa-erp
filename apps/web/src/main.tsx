import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are bundled with the app so it looks right with no internet.
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/noto-sans-arabic/400.css';
import '@fontsource/noto-sans-arabic/500.css';
import '@fontsource/noto-sans-arabic/600.css';
import '@fontsource/noto-sans-arabic/700.css';
import '@fontsource/noto-kufi-arabic/700.css';
import './styles.css';
import { App } from './App.tsx';

async function start() {
  // The website demo runs the whole API inside the page (see src/demo); the real app talks to its server.
  if (import.meta.env.MODE === 'demo') {
    const { startDemoBackend } = await import('./demo/backend.ts');
    await startDemoBackend();
  }
  // 2.0: the customer screen, a second window of this page facing the customer (pages/CustomerDisplay.tsx): only what
  // the till in this browser sends it, no sign-in and nothing from the server
  if (location.hash.startsWith('#/customer-display')) {
    const { CustomerDisplay } = await import('./pages/CustomerDisplay.tsx');
    createRoot(document.getElementById('root')!).render(<StrictMode><CustomerDisplay /></StrictMode>);
    return;
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void start();
