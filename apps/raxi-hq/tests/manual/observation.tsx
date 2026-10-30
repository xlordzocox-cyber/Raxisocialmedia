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
// Opt-in browser QA fixture only. Does not change OS/browser preferences or production code.
const reducedMotionFixture = new URLSearchParams(window.location.search).get('motion') === 'reduce';
if (reducedMotionFixture) {
  const matchMedia = window.matchMedia.bind(window);
  window.matchMedia = query => {
    const result = matchMedia(query);
    return query === '(prefers-reduced-motion: reduce)'
      ? Object.defineProperty(result, 'matches', { value: true }) : result;
  };
}
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
  {reducedMotionFixture && <p role="note">MOVIMIENTO REDUCIDO · preferencia simulada exclusivamente para QA local.</p>}
  <AuthProvider store={auth}><MemoryRouter><Routes><Route element={<ProtectedRoute/>}><Route path="/" element={<App ideaRepository={repository}/>}/></Route></Routes></MemoryRouter></AuthProvider>
</StrictMode>);
