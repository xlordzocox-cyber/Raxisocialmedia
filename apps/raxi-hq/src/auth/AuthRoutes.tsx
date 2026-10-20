import { lazy, Suspense, useState, type FormEvent } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

const Office = lazy(() => import('../App'));
export function safeReturnPath(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') && !/[\r\n]/.test(value) && value.split(/[?#]/)[0] !== '/login' ? value : '/';
}
function Loading() { return <main className="auth-shell" role="status">Comprobando acceso…</main>; }
function AuthenticatedOffice() {
  const { user } = useAuth();
  return <Suspense fallback={<Loading />}><Office key={user!.id} /></Suspense>;
}
export function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') return <Loading />;
  if (auth.status !== 'signedIn') return <Navigate to="/login" replace state={{ from: location.pathname + location.search + location.hash }} />;
  return <Outlet />;
}
function Login() {
  const auth = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (auth.status === 'loading') return <Loading />;
  if (auth.status === 'signedIn') return <Navigate to={safeReturnPath(location.state?.from)} replace />;
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { await auth.signIn(email, password); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo iniciar sesión.'); }
    finally { setBusy(false); setPassword(''); }
  }
  return <main className="auth-shell"><section className="auth-card" aria-labelledby="auth-title">
    <p>RAXI HQ · STUDIO</p><h1 id="auth-title">Entra a tu oficina</h1>
    <p>Accede con la cuenta de tu equipo.</p>
    {auth.status === 'unconfigured' ? <p role="alert">El acceso todavía no está configurado. Contacta con quien administra el estudio.</p> : <form onSubmit={submit}>
      <label htmlFor="email">Correo electrónico</label><input id="email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
      <label htmlFor="password">Contraseña</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
      {(error || auth.error) && <p role="alert">{error || auth.error}</p>}
      <button disabled={busy} type="submit">{busy ? 'Entrando…' : 'Iniciar sesión'}</button>
      {auth.error?.includes('cerrar') && <button type="button" onClick={() => { void auth.signOut(); }}>Reintentar cierre de sesión</button>}
    </form>}
    <p>¿Necesitas una cuenta? Pide acceso a quien administra el estudio.</p>
  </section></main>;
}
export function AuthRoutes() {
  return <Routes><Route path="/login" element={<Login />} /><Route element={<ProtectedRoute />}>
    <Route path="/" element={<AuthenticatedOffice />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route></Routes>;
}
