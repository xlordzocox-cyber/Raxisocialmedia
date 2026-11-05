import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AuthStore } from '../src/auth/authStore';
import { AuthProvider } from '../src/auth/AuthProvider';
import { ProtectedRoute, AuthRoutes, safeReturnPath } from '../src/auth/AuthRoutes';
import { readAuthConfig } from '../src/auth/config';

const user = { id: 'test-user', email: 'team@example.test' } as User;
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
function fixture() {
  let callback: (event: string, session?: { user: User }) => void = () => {};
  let unsubscribed = false;
  let result: { data: { user: User | null }; error: { name: string } | null } = { data: { user }, error: null };
  let resolveUser = async () => result;
  let signInError: object | null = null;
  let recoveryRequests: Array<{ email: string; redirectTo: string }> = [];
  let updatedPasswords: string[] = [];
  const api = {
    getUser: () => resolveUser(),
    onAuthStateChange: (cb: typeof callback) => { callback = cb; return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } }; },
    signInWithPassword: async () => ({ error: signInError }),
    signOut: async () => { callback('SIGNED_OUT'); return { error: null }; },
    resetPasswordForEmail: async (email: string, options: { redirectTo: string }) => { recoveryRequests.push({ email, redirectTo: options.redirectTo }); return { error: null }; },
    updateUser: async (value: { password: string }) => { updatedPasswords.push(value.password); return { error: null }; },
  };
  return {
    store: new AuthStore(api as unknown as SupabaseClient['auth']),
    emit: (event: string) => callback(event),
    refresh: () => callback('TOKEN_REFRESHED', { user }),
    missing: () => { result = { data: { user: null }, error: { name: 'AuthSessionMissingError' } }; },
    rejectLogin: () => { signInError = {}; },
    defer: () => { let resolve!: (value: typeof result) => void; const promise = new Promise<typeof result>(r => { resolve = r; }); resolveUser = () => promise; return () => resolve({ data: { user }, error: null }); },
    offline: () => { resolveUser = async () => { throw new Error('offline'); }; },
    unsubscribed: () => unsubscribed,
    recoveryRequests: () => recoveryRequests,
    updatedPasswords: () => updatedPasswords,
  };
}

test('configuration fails closed for missing settings and private keys', () => {
  assert.equal(readAuthConfig({}), null);
  for (const key of ['sb_secret_example', 'legacy-jwt', '']) assert.equal(readAuthConfig({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: key }), null);
  assert.equal(readAuthConfig({ VITE_SUPABASE_URL: 'http://example.com', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example' }), null);
  assert.deepEqual(readAuthConfig({ VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example' }), { url: 'https://example.supabase.co', key: 'sb_publishable_example' });
});

test('session must be validated, missing and failed sessions remain signed out', async () => {
  const f = fixture(); assert.equal(f.store.getSnapshot().status, 'loading');
  await f.store.validate(); assert.equal(f.store.getSnapshot().user?.id, user.id);
  f.missing(); await f.store.validate(); assert.equal(f.store.getSnapshot().status, 'signedOut'); assert.equal(f.store.getSnapshot().error, null);
  f.offline(); await f.store.validate(); assert.equal(f.store.getSnapshot().user, null); assert.ok(f.store.getSnapshot().error);
});

test('failed login does not grant access; successful login and logout update state', async () => {
  const f = fixture(); await f.store.signIn('team@example.test', ''); assert.equal(f.store.getSnapshot().status, 'signedIn');
  await f.store.signOut(); assert.equal(f.store.getSnapshot().status, 'signedOut');
  f.rejectLogin(); await assert.rejects(f.store.signIn('team@example.test', '')); assert.equal(f.store.getSnapshot().user, null);
});

test('a stale session response cannot reopen the office after logout', async () => {
  const f = fixture(); const resolve = f.defer(); const pending = f.store.validate();
  await f.store.signOut(); resolve(); await pending; assert.equal(f.store.getSnapshot().status, 'signedOut');
});

test('expiry removes access immediately; subscriptions and stale work are cleaned up', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  try {
    const f = fixture(); const stop = f.store.start(); await tick(); assert.equal(f.store.getSnapshot().status, 'signedIn');
    f.missing(); f.emit('TOKEN_REFRESHED'); assert.equal(f.store.getSnapshot().user, null);
    await tick(); assert.equal(f.store.getSnapshot().status, 'signedOut');
    f.emit('SIGNED_OUT'); assert.equal(f.store.getSnapshot().status, 'signedOut');
    stop(); assert.equal(f.unsubscribed(), true);
    const stopAgain = f.store.start(); await tick(); stopAgain();
  } finally { if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window'); }
});
test('same-user token refresh keeps the verified office mounted while revalidating', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  try {
    const f = fixture(); const stop = f.store.start(); await tick();
    f.refresh(); assert.equal(f.store.getSnapshot().status, 'signedIn');
    await tick(); assert.equal(f.store.getSnapshot().status, 'signedIn'); stop();
  } finally { if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window'); }
});

function protectedMarkup(store: AuthStore) {
  return renderToString(<AuthProvider store={store}><MemoryRouter initialEntries={['/private']}><Routes>
    <Route element={<ProtectedRoute />}><Route path="/private" element={<div>Private office content</div>} /></Route>
  </Routes></MemoryRouter></AuthProvider>);
}
test('protected route never renders content while loading, signed out or unconfigured', async () => {
  const f = fixture(); assert.ok(!protectedMarkup(f.store).includes('Private office content'));
  await f.store.validate(); assert.ok(protectedMarkup(f.store).includes('Private office content'));
  await f.store.signOut(); assert.ok(!protectedMarkup(f.store).includes('Private office content'));
  assert.ok(!protectedMarkup(new AuthStore(null)).includes('Private office content'));
});
test('missing configuration renders a helpful login screen without a usable form', () => {
  const markup = renderToString(<AuthProvider store={new AuthStore(null)}><MemoryRouter initialEntries={['/login']}><AuthRoutes /></MemoryRouter></AuthProvider>);
  assert.ok(markup.includes('todavía no está configurado')); assert.ok(!markup.includes('<form'));
});
test('return paths stay inside the app and avoid login loops', () => {
  for (const path of ['https://example.com', '//example.com', '/\\example.com', '/login', '/login?next=/', null, '/\nexample.com']) assert.equal(safeReturnPath(path), '/');
  assert.equal(safeReturnPath('/?view=office#agent'), '/?view=office#agent');
});

test('password recovery requests an explicit local callback and never exposes account existence', async () => {
  const f = fixture();
  await f.store.requestPasswordRecovery(' team@example.test ', 'http://127.0.0.1:5174/reset-password');
  assert.deepEqual(f.recoveryRequests(), [{ email: 'team@example.test', redirectTo: 'http://127.0.0.1:5174/reset-password' }]);
});

test('password reset fails closed for ordinary signed-in users and invalid sessions', async () => {
  const f = fixture(); await f.store.validate();
  await assert.rejects(f.store.completePasswordRecovery('long-test-password'));
  assert.equal(f.updatedPasswords().length, 0);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  try {
    const stop = f.store.start(); f.emit('PASSWORD_RECOVERY'); await tick();
    f.missing(); await assert.rejects(f.store.completePasswordRecovery('long-test-password'));
    assert.equal(f.updatedPasswords().length, 0);
    stop();
  } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
});

test('verified recovery updates password once, signs out, and cannot be reused', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  try {
    const f = fixture(); const stop = f.store.start(); f.emit('PASSWORD_RECOVERY'); await tick();
    assert.equal(f.store.getSnapshot().recovery, true);
    assert.equal(f.store.getSnapshot().status, 'signedIn');
    await f.store.completePasswordRecovery('long-test-password');
    assert.equal(f.store.getSnapshot().status, 'signedOut');
    assert.deepEqual(f.updatedPasswords(), ['long-test-password']);
    await assert.rejects(f.store.completePasswordRecovery('another-password'));
    stop();
  } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
});

test('login exposes recovery request; reset route does not expose a password form without recovery', async () => {
  const f = fixture();
  await f.store.signOut();
  const html = renderToString(<AuthProvider store={f.store}><MemoryRouter initialEntries={['/login']}><AuthRoutes /></MemoryRouter></AuthProvider>);
  assert.ok(html.includes('Olvidaste tu contraseña'));
  const reset = renderToString(<AuthProvider store={f.store}><MemoryRouter initialEntries={['/reset-password']}><AuthRoutes /></MemoryRouter></AuthProvider>);
  assert.ok(!reset.includes('new-password'));
});
