import { lazy, Suspense, useState, type FormEvent } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { PasswordRecoverySignOutError } from './authStore';

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
  if (auth.recovery) return <Navigate to="/reset-password" replace />;
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
  if (auth.recovery) return <Navigate to="/reset-password" replace />;
  if (auth.status === 'signedIn') return <Navigate to={safeReturnPath(location.state?.from)} replace />;
  if(auth.status==='signOutError')return <main className="auth-shell"><section className="auth-card"><h1>Cierre de sesión sin confirmar</h1><p role="alert">{auth.error}</p><button type="button" onClick={()=>{void auth.signOut();}}>Reintentar cierre de sesión</button></section></main>;
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
      <Link to="/forgot-password">¿Olvidaste tu contraseña?</Link>
      {auth.error?.includes('cerrar') && <button type="button" onClick={() => { void auth.signOut(); }}>Reintentar cierre de sesión</button>}
    </form>}
    <p>¿Necesitas una cuenta? Pide acceso a quien administra el estudio.</p>
  </section></main>;
}
function ForgotPassword() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await auth.requestPasswordRecovery(email, window.location.origin + '/reset-password');
      setSubmitted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo solicitar la recuperación.');
    } finally { setBusy(false); }
  }
  return <main className="auth-shell"><section className="auth-card" aria-labelledby="forgot-title">
    <p>RAXI HQ · STUDIO</p><h1 id="forgot-title">Recuperar acceso</h1>
    {auth.status === 'unconfigured' ? <p role="alert">El acceso todavía no está configurado.</p> : submitted
      ? <p role="status">Si el correo tiene una cuenta, recibirás instrucciones para recuperar el acceso. Revisa también spam.</p>
      : <form onSubmit={submit}>
          <p>Introduce el correo de tu cuenta. El enlace puede caducar y está sujeto a límites de envío.</p>
          <label htmlFor="recovery-email">Correo electrónico</label>
          <input id="recovery-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Solicitando…' : 'Enviar enlace de recuperación'}</button>
        </form>}
    <Link to="/login">Volver al inicio de sesión</Link>
  </section></main>;
}
function ResetPassword() {
  const auth = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [passwordChanged,setPasswordChanged]=useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 12) { setError('Utiliza una contraseña de al menos 12 caracteres.'); return; }
    if (password !== confirmation) { setError('Las contraseñas no coinciden.'); return; }
    setBusy(true); setError(null);
    try { await auth.completePasswordRecovery(password); setDone(true); }
    catch (cause) { if(cause instanceof PasswordRecoverySignOutError)setPasswordChanged(true);setError(cause instanceof Error ? cause.message : 'No se pudo cambiar la contraseña.'); }
    finally { setBusy(false); setPassword(''); setConfirmation(''); }
  }
  return <main className="auth-shell"><section className="auth-card" aria-labelledby="reset-title">
    <p>RAXI HQ · STUDIO</p><h1 id="reset-title">Nueva contraseña</h1>
    {done ? <p role="status">Contraseña actualizada. Inicia sesión con tu nueva contraseña.</p>
      : auth.status === 'loading' ? <p role="status">Verificando enlace de recuperación…</p>
      : auth.recovery && auth.status === 'signedIn' ? <form onSubmit={submit}>
        <label htmlFor="new-password">Nueva contraseña</label>
        <input id="new-password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
        <label htmlFor="confirm-password">Confirmar contraseña</label>
        <input id="confirm-password" type="password" autoComplete="new-password" minLength={12} required value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} />
        <button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar nueva contraseña'}</button>
      </form> : auth.status==='signOutError'?<p role="status">El cierre de sesión está pendiente de confirmación.</p>:<p role="alert">Este enlace de recuperación no es válido, ya se utilizó o ha caducado. Solicita uno nuevo.</p>}
    {!done && (error||auth.error) && <p role="alert">{error||auth.error}</p>}
    {auth.status==='signOutError' && <button type="button" disabled={busy} onClick={async()=>{setBusy(true);try{if(await auth.signOut()){setError(null);if(passwordChanged)setDone(true);}}finally{setBusy(false);}}}>Reintentar cierre de sesión</button>}
    <Link to={done ? '/login' : '/forgot-password'}>{done ? 'Iniciar sesión' : 'Solicitar otro enlace'}</Link>
  </section></main>;
}
export function AuthRoutes() {
  return <Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/forgot-password" element={<ForgotPassword />} />
    <Route path="/reset-password" element={<ResetPassword />} />
    <Route element={<ProtectedRoute />}>
      <Route path="/" element={<AuthenticatedOffice />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes>;
}
