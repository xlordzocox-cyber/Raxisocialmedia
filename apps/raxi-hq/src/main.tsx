import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { AuthRoutes } from './auth/AuthRoutes';
import { AuthStore } from './auth/authStore';
import { supabase } from './auth/client';
import './design/tokens.css';
import './design/global.css';
import './campus/campus.css';

const authStore = new AuthStore(supabase?.auth ?? null);
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <BrowserRouter><AuthProvider store={authStore}><AuthRoutes /></AuthProvider></BrowserRouter>
  </StrictMode>,
);
