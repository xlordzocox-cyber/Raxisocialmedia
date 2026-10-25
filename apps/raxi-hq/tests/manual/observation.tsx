// Local visual harness, excluded from the production entrypoint. Auth/repositories are TEST DOUBLES.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import App from '../../src/App';
import { AuthStore } from '../../src/auth/authStore';
import { AuthProvider } from '../../src/auth/AuthProvider';
import { ProtectedRoute } from '../../src/auth/AuthRoutes';
import '../../src/design/tokens.css';
import '../../src/design/global.css';
import '../../src/campus/campus.css';
const auth = new AuthStore({
  getUser: async () => ({ data: { user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } as User }, error: null }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  signOut: async () => ({ error: null }),
} as unknown as SupabaseClient['auth']);
const repository = () => ({
  findWorkspace: async () => null,
  createWorkspace: async () => { throw new Error('TEST ONLY: escritura bloqueada'); },
  listIdeas: async () => [],
  createIdea: async () => { throw new Error('TEST ONLY: escritura bloqueada'); },
});
createRoot(document.getElementById('root')!).render(<StrictMode>
  <p role="note">ENSAYO LOCAL: Auth y repositorios simulados. La captura de Codex es histórica auténtica. No prueba Auth alojado ni actividad en vivo.</p>
  <AuthProvider store={auth}><MemoryRouter><Routes><Route element={<ProtectedRoute/>}><Route path="/" element={<App ideaRepository={repository}/>}/></Route></Routes></MemoryRouter></AuthProvider>
</StrictMode>);
