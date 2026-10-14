import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './design/tokens.css';
import './design/global.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
