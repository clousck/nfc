import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource-variable/ibm-plex-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Falta #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
