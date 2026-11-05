import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import { act,create,type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AuthStore } from '../src/auth/authStore';
import { AuthProvider } from '../src/auth/AuthProvider';
import { ProtectedRoute, AuthRoutes, safeReturnPath } from '../src/auth/AuthRoutes';
import { readAuthConfig } from '../src/auth/config';

const user = { id: 'test-user', email: 'team@example.test' } as User;
// Intentionally unsigned synthetic tokens: session_id correlation fixtures only.
// Fake getUser supplies server verification; these never reach Supabase.
const sessionFor=(u=user,id='synthetic-session',expires=Date.now()/1000+3600)=>({user:u,expires_at:expires,access_token:`synthetic.${btoa(JSON.stringify({sub:u.id,session_id:id}))}.unsigned`});
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
function fixture() {
  let callback: (event: string, session?: { user: User; expires_at?: number; access_token?:string }) => void = () => {};
  let unsubscribed = false;
  let result: { data: { user: User | null }; error: { name: string } | null } = { data: { user }, error: null };
  let resolveUser = async () => result;
  let signInError: object | null = null;
  let signOutError: object | null = null;
  let signOutEventOnError=false,updateEvent=false,signOutThrows=false;
  let currentSession='synthetic-session',sessionNumber=0;
  let finishUpdate:(()=>Promise<void>)|undefined;
  let recoveryRequests: Array<{ email: string; redirectTo: string }> = [];
  let updatedPasswords: string[] = [];
  const api = {
    getUser: () => resolveUser(),
    onAuthStateChange: (cb: typeof callback) => { callback = cb; return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } }; },
    signInWithPassword: async () => ({ error: signInError }),
    signOut: async () => { if(signOutThrows)throw Error('synthetic network failure');if(!signOutError||signOutEventOnError)callback('SIGNED_OUT');return { error: signOutError }; },
    resetPasswordForEmail: async (email: string, options: { redirectTo: string }) => { recoveryRequests.push({ email, redirectTo: options.redirectTo }); return { error: null }; },
    updateUser: async (value: { password: string }) => { updatedPasswords.push(value.password);if(updateEvent)callback('USER_UPDATED',sessionFor(result.data.user!,currentSession));await finishUpdate?.();return { error: null }; },
  };
  return {
    store: new AuthStore(api as unknown as SupabaseClient['auth']),
    emit: (event: string, session = event==='PASSWORD_RECOVERY'?sessionFor(result.data.user??user,currentSession):undefined) => callback(event,session),
    changeUser: (next: User) => {currentSession=`synthetic-session-${++sessionNumber}`;result={data:{user:next},error:null};resolveUser=async()=>result;callback('SIGNED_IN',sessionFor(next,currentSession)); },
    refocus:()=>callback('SIGNED_IN',sessionFor(result.data.user??user,currentSession)),
    failSignOut: (emitBeforeError=false) => { signOutError={name:'AuthRetryableFetchError'};signOutEventOnError=emitBeforeError; },
    throwSignOut: () => {signOutThrows=true;},
    emitUpdate: () => {updateEvent=true;},
    deferUpdate:()=>{let resolve!:()=>void;const pending=new Promise<void>(r=>{resolve=r;});finishUpdate=()=>pending;return resolve;},
    allowSignOut: () => { signOutError=null; },
    refresh: () => callback('TOKEN_REFRESHED', sessionFor(result.data.user??user,currentSession)),
    missing: () => { result = { data: { user: null }, error: { name: 'AuthSessionMissingError' } }; },
    rejectLogin: () => { signInError = {}; },
    defer: () => { let resolve!: (value: typeof result) => void; const promise = new Promise<typeof result>(r => { resolve = r; }); resolveUser = () => promise; return (next=user) => resolve({ data: { user:next }, error: null }); },
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

test('logout failure after a confirmed password update must reject completion, not claim signedOut',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:new EventTarget()});
  try{const f=fixture(),stop=f.store.start();f.emit('PASSWORD_RECOVERY');await tick();f.failSignOut();
    await assert.rejects(f.store.completePasswordRecovery('long-test-password'));
    assert.equal(f.updatedPasswords().length,1);assert.notEqual(f.store.getSnapshot().status,'signedOut');assert.equal(f.store.getSnapshot().recovery,false);assert.ok(!protectedMarkup(f.store).includes('Private office content'));stop();
  }finally{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});
test('failed validation followed by ordinary login cannot revive a prior recovery permission',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:new EventTarget()});
  try{const f=fixture(),stop=f.store.start();f.emit('PASSWORD_RECOVERY');await tick();assert.equal(f.store.getSnapshot().recovery,true);
    f.missing();await f.store.validate();f.changeUser({...user,id:'other-user'});await tick();assert.equal(f.store.getSnapshot().recovery,false);
    await assert.rejects(f.store.completePasswordRecovery('long-test-password'));assert.equal(f.updatedPasswords().length,0);stop();
  }finally{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});

async function recoveryCase(run:(f:ReturnType<typeof fixture>)=>Promise<void>){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:new EventTarget()});
  const f=fixture(),stop=f.store.start();
  try{f.emit('PASSWORD_RECOVERY');await tick();await run(f);}finally{stop();if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
}
test('signOut returns false on SDK error or throw, fences revalidation/login, and permits explicit cleanup retry',async()=>{
  for(const failure of ['error','throw'] as const){const f=fixture();await f.store.validate();if(failure==='error')f.failSignOut();else f.throwSignOut();
    assert.equal(await f.store.signOut(),false);assert.equal(f.store.getSnapshot().status,'signOutError');assert.equal(f.store.getSnapshot().user,null);
    await f.store.validate();assert.equal(f.store.getSnapshot().status,'signOutError');await assert.rejects(f.store.signIn('team@example.test','synthetic'));
    if(failure==='error'){f.allowSignOut();assert.equal(await f.store.signOut(),true);assert.equal(f.store.getSnapshot().status,'signedOut');}
  }
});
test('an SDK SIGNED_OUT callback before a returned logout error does not confirm success',async()=>{
  await recoveryCase(async f=>{f.failSignOut(true);await assert.rejects(f.store.completePasswordRecovery('long-test-password'));assert.equal(f.store.getSnapshot().status,'signOutError');
    f.emit('SIGNED_IN',{user,expires_at:Date.now()/1000+3600});await tick();assert.equal(f.store.getSnapshot().status,'signOutError');
    await assert.rejects(f.store.completePasswordRecovery('another-password'));assert.equal(f.updatedPasswords().length,1);
  });
});
for(const invalid of ['expired','missing','anonymous'] as const)test(`PASSWORD_RECOVERY ${invalid} session cannot arm a recovery grant`,async()=>{
  await recoveryCase(async f=>{
    if(invalid==='expired')f.emit('PASSWORD_RECOVERY',sessionFor(user,'synthetic-session',Date.now()/1000-1));
    if(invalid==='missing')f.emit('PASSWORD_RECOVERY',{} as any);
    if(invalid==='anonymous')f.emit('PASSWORD_RECOVERY',sessionFor({...user,is_anonymous:true}));
    await tick();assert.equal(f.store.getSnapshot().recovery,false);await assert.rejects(f.store.completePasswordRecovery('long-test-password'));assert.equal(f.updatedPasswords().length,0);
  });
});
test('expiry timer removes recovery permission even if no subsequent auth event arrives',async t=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:new EventTarget()});
  t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});const f=fixture(),stop=f.store.start();
  try{await Promise.resolve();f.emit('PASSWORD_RECOVERY',sessionFor(user,'synthetic-session',101));t.mock.timers.tick(0);await Promise.resolve();assert.equal(f.store.getSnapshot().recovery,true);
    t.mock.timers.tick(1000);assert.equal(f.store.getSnapshot().recovery,false);await assert.rejects(f.store.completePasswordRecovery('long-test-password'));assert.equal(f.updatedPasswords().length,0);
  }finally{stop();t.mock.timers.reset();if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});
test('Auth expiry during submit consumes permission; a normal same-user session cannot revive it',async()=>{
  await recoveryCase(async f=>{f.missing();await assert.rejects(f.store.completePasswordRecovery('long-test-password'));assert.equal(f.store.getSnapshot().recovery,false);
    f.changeUser(user);await tick();await assert.rejects(f.store.completePasswordRecovery('another-password'));assert.equal(f.updatedPasswords().length,0);
  });
});
test('network validation failure consumes permission before an ordinary session returns',async()=>{
  await recoveryCase(async f=>{f.offline();await f.store.validate();f.changeUser(user);await tick();assert.equal(f.store.getSnapshot().recovery,false);await assert.rejects(f.store.completePasswordRecovery('long-test-password'));assert.equal(f.updatedPasswords().length,0);});
});
test('identity switch and explicit same-user login remove the old recovery grant',async()=>{
  for(const next of [user,{...user,id:'other-user'}])await recoveryCase(async f=>{f.changeUser(next);await tick();assert.equal(f.store.getSnapshot().recovery,false);await assert.rejects(f.store.completePasswordRecovery('long-test-password'));assert.equal(f.updatedPasswords().length,0);});
  await recoveryCase(async f=>{await f.store.signIn('team@example.test','synthetic');assert.equal(f.store.getSnapshot().recovery,false);await assert.rejects(f.store.completePasswordRecovery('long-test-password'));});
});
test('same-owner token refresh and USER_UPDATED preserve a legitimate recovery completion',async()=>{
  await recoveryCase(async f=>{f.refresh();await tick();assert.equal(f.store.getSnapshot().recovery,true);f.emitUpdate();await f.store.completePasswordRecovery('long-test-password');assert.equal(f.store.getSnapshot().status,'signedOut');assert.equal(f.updatedPasswords().length,1);});
});
test('account change during awaited recovery verification cannot update the new account',async()=>{
  await recoveryCase(async f=>{const resolve=f.defer(),pending=f.store.completePasswordRecovery('long-test-password'),rejection=assert.rejects(pending);f.changeUser({...user,id:'other-user'});await tick();resolve({...user,id:'other-user'});await rejection;assert.equal(f.updatedPasswords().length,0);assert.equal(f.store.getSnapshot().user?.id,'other-user');});
});
test('logout during awaited verification prevents updateUser and does not dereference a missing user',async()=>{
  await recoveryCase(async f=>{const resolve=f.defer(),pending=f.store.completePasswordRecovery('long-test-password'),rejection=assert.rejects(pending,/cambió|caducado/);await f.store.signOut();resolve();await rejection;assert.equal(f.updatedPasswords().length,0);assert.equal(f.store.getSnapshot().status,'signedOut');});
});
test('concurrent submissions cannot write two password updates',async()=>{
  await recoveryCase(async f=>{const resolve=f.defer(),pending=f.store.completePasswordRecovery('long-test-password');await assert.rejects(f.store.completePasswordRecovery('another-password'));resolve();await pending;assert.equal(f.updatedPasswords().length,1);});
});
test('same-session SIGNED_IN on refocus preserves recovery without granting a new login permission',async()=>{
  await recoveryCase(async f=>{f.refocus();await tick();assert.equal(f.store.getSnapshot().recovery,true);await f.store.completePasswordRecovery('long-test-password');assert.equal(f.updatedPasswords().length,1);});
});
test('expiry during a confirmed update still requires cleanup and exposes a logout error for retry',async t=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:new EventTarget()});
  t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});const f=fixture(),stop=f.store.start();
  try{await Promise.resolve();f.emit('PASSWORD_RECOVERY',sessionFor(user,'synthetic-session',101));t.mock.timers.tick(0);await Promise.resolve();
    const finish=f.deferUpdate();f.failSignOut();const pending=f.store.completePasswordRecovery('long-test-password'),rejected=assert.rejects(pending,/contraseña se actualizó/);await Promise.resolve();assert.equal(f.updatedPasswords().length,1);
    t.mock.timers.tick(1000);finish();await rejected;assert.equal(f.store.getSnapshot().status,'signOutError');assert.equal(f.store.getSnapshot().recovery,false);
    f.allowSignOut();assert.equal(await f.store.signOut(),true);
  }finally{stop();t.mock.timers.reset();if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});
test('an already consumed recovery session cannot rearm from a repeated PASSWORD_RECOVERY notification',async()=>{
  await recoveryCase(async f=>{await f.store.completePasswordRecovery('long-test-password');f.emit('PASSWORD_RECOVERY');await tick();assert.equal(f.store.getSnapshot().recovery,false);await assert.rejects(f.store.completePasswordRecovery('another-password'));assert.equal(f.updatedPasswords().length,1);});
});
test('late update acknowledgement cannot sign out a new same-user session',async()=>{
  await recoveryCase(async f=>{const finish=f.deferUpdate(),pending=f.store.completePasswordRecovery('long-test-password'),rejected=assert.rejects(pending,/sesión cambió/);await Promise.resolve();f.changeUser(user);await tick();finish();await rejected;assert.equal(f.store.getSnapshot().status,'signedIn');assert.equal(f.store.getSnapshot().recovery,false);});
});
test('mounted reset screen never shows success when cleanup fails, exposes error and can retry cleanup only',async()=>{
  Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
  await recoveryCase(async f=>{let view!:ReactTestRenderer;await act(async()=>{view=create(<AuthProvider store={f.store}><MemoryRouter initialEntries={['/reset-password']}><AuthRoutes/></MemoryRouter></AuthProvider>);});
    const text=()=>JSON.stringify(view.toJSON());const inputs=view.root.findAllByType('input');
    await act(async()=>{inputs[0].props.onChange({target:{value:'long-test-password'}});inputs[1].props.onChange({target:{value:'long-test-password'}});});
    f.failSignOut();await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
    assert.equal(text().includes('Contraseña actualizada. Inicia sesión'),false);assert.ok(text().includes('La contraseña se actualizó, pero'));assert.equal(view.root.findAllByType('form').length,0);
    f.allowSignOut();const retry=view.root.findAllByType('button').find(b=>b.children.join('')==='Reintentar cierre de sesión')!;await act(async()=>retry.props.onClick());
    assert.ok(text().includes('Contraseña actualizada. Inicia sesión'));assert.equal(f.updatedPasswords().length,1);await act(async()=>view.unmount());
  });
});
