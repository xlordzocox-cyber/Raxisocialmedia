import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { RealIdeaStore } from '../persistence/realIdeaStore';
import type { RealCampaignStore } from '../persistence/realCampaignStore';

type AuthApi = Pick<SupabaseClient['auth'], 'getUser' | 'onAuthStateChange' | 'signInWithPassword' | 'signOut' | 'resetPasswordForEmail' | 'updateUser'>;
export type AuthState = { status: 'loading' | 'signedOut' | 'signedIn' | 'unconfigured' | 'signOutError'; user: User | null; error: string | null; recovery?: boolean };

export class PasswordRecoverySignOutError extends Error {
  constructor(){super('La contraseña se actualizó, pero no se pudo confirmar el cierre de sesión. Reintenta el cierre antes de iniciar sesión.');}
}

export class AuthStore {
  private state: AuthState;
  private listeners = new Set<() => void>();
  private revision = 0;
  private loggingOut = false;
  private recoveryGrant: { userId: string; sessionKey: string; expiresAt: number } | null = null;
  private currentSessionKey: string | null = null;
  private sessionEpoch=0;
  private consumedRecoveries = new Map<string,number>();
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private recovering = false;
  private realIdeas: RealIdeaStore | null = null;
  private realCampaigns: { workspace: string; store: RealCampaignStore } | null = null;

  constructor(private auth: AuthApi | null) {
    this.state = { status: auth ? 'loading' : 'unconfigured', user: null, error: null };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private clearRecovery(){clearTimeout(this.recoveryTimer);this.recoveryGrant=null;}
  private hasRecovery(){return !!this.recoveryGrant && this.recoveryGrant.expiresAt>Date.now();}
  private sessionKey(session:Session|null){
    // Correlation only, not JWT verification or authorization. getUser remains
    // the server verification gate before a password update. No token is retained.
    try{
      if(!session?.user?.id || session.user.is_anonymous)return null;
      const claims=JSON.parse(atob(session.access_token.split('.')[1].replaceAll('-','+').replaceAll('_','/')));
      return claims.sub===session.user.id && typeof claims.session_id==='string' && claims.session_id.length>0 && claims.session_id.length<=128
        ?JSON.stringify([session.user.id,claims.session_id]):null;
    }catch{return null;}
  }
  private set(state: AuthState) {
    if(['signedOut','unconfigured','signOutError'].includes(state.status) || (state.user && state.user.id!==this.recoveryGrant?.userId))this.clearRecovery();
    // Session ownership, independent of App/panel mount and StrictMode effect cleanup.
    if (state.status !== 'signedIn' || state.user?.id !== this.state.user?.id) {
      this.realIdeas?.dispose();
      this.realIdeas = null;
      this.realCampaigns?.store.dispose(); this.realCampaigns = null;
    }
    this.state = { ...state, recovery: this.hasRecovery() && state.status === 'signedIn' && state.user?.id===this.recoveryGrant?.userId }; this.listeners.forEach(listener => listener());
  }
  getRealIdeaStore = (create: (ownerId: string) => RealIdeaStore): RealIdeaStore => {
    if (this.state.status !== 'signedIn' || !this.state.user) throw new Error('Se requiere una sesión verificada.');
    return this.realIdeas ??= create(this.state.user.id);
  };
  getRealCampaignStore = (workspace: string, create: (ownerId: string) => RealCampaignStore): RealCampaignStore => {
    if (this.state.status !== 'signedIn' || !this.state.user) throw new Error('Se requiere una sesión verificada.');
    if (this.realCampaigns?.workspace !== workspace) { this.realCampaigns?.store.dispose(); this.realCampaigns = { workspace, store: create(this.state.user.id) }; }
    return this.realCampaigns.store;
  };

  // Validate against Auth instead of trusting the user object in local storage.
  async validate() {
    if (!this.auth || this.loggingOut || this.state.status==='signOutError') return;
    const revision = ++this.revision;
    if (this.state.status !== 'signedIn') this.set({ status: 'loading', user: null, error: null });
    try {
      const { data, error } = await this.auth.getUser();
      if (revision !== this.revision) return;
      this.set(error || !data.user || data.user.is_anonymous
        ? { status: 'signedOut', user: null, error: error && error.name !== 'AuthSessionMissingError' ? 'No se pudo validar la sesión. Vuelve a iniciar sesión.' : null }
        : { status: 'signedIn', user: data.user, error: null });
    } catch {
      if (revision === this.revision) this.set({ status: 'signedOut', user: null, error: 'No se pudo conectar con el servicio de acceso. Inténtalo de nuevo.' });
    }
  }

  start() {
    if (!this.auth) return () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const { data: { subscription } } = this.auth.onAuthStateChange((event, session) => {
      clearTimeout(timer);
      ++this.revision;
      // Logout is confirmed only by its returned result, including when an SDK
      // emits SIGNED_OUT before reporting a server/network failure.
      if(this.loggingOut || this.state.status==='signOutError')return;
      const sessionKey=this.sessionKey(session);
      if(sessionKey!==this.currentSessionKey)++this.sessionEpoch;
      this.currentSessionKey=sessionKey;
      if(event==='PASSWORD_RECOVERY'){
        this.clearRecovery();
        for(const [key,expires] of this.consumedRecoveries)if(expires<=Date.now())this.consumedRecoveries.delete(key);
        const expiresAt=(session?.expires_at??0)*1000;
        if(session?.user?.id && this.currentSessionKey && !this.consumedRecoveries.has(this.currentSessionKey) && Number.isFinite(expiresAt) && expiresAt>Date.now()){
          this.recoveryGrant={userId:session.user.id,sessionKey:this.currentSessionKey,expiresAt};
          const grant=this.recoveryGrant;
          this.recoveryTimer=setTimeout(()=>{if(this.recoveryGrant===grant){this.clearRecovery();this.set({...this.state});}},Math.min(expiresAt-Date.now(),2147483647));
        }
      } else if(event==='SIGNED_OUT' || !session?.user || this.currentSessionKey!==this.recoveryGrant?.sessionKey || !this.hasRecovery())this.clearRecovery();
      // Preserve an already verified user's form during a refresh; account switches clear it.
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_OUT' || this.state.status !== 'signedIn' || session?.user?.id !== this.state.user?.id) {
        this.set({ status: event === 'SIGNED_OUT' ? 'signedOut' : 'loading', user: null, error: null });
      }
      // Supabase Auth callbacks must not await another Auth method under its lock.
      if (event !== 'SIGNED_OUT') timer = setTimeout(() => { void this.validate(); }, 0);
    });
    void this.validate();
    const onFocus = () => { if (this.state.status === 'signedIn') void this.validate(); };
    window.addEventListener('focus', onFocus);
    return () => { ++this.revision; clearTimeout(timer);this.clearRecovery();this.set({...this.state}); subscription.unsubscribe(); window.removeEventListener('focus', onFocus); };
  }

  async signIn(email: string, password: string) {
    if (!this.auth) throw new Error('El acceso aún no está configurado.');
    if(this.loggingOut || this.state.status==='signOutError')throw new Error('Primero reintenta el cierre de sesión pendiente.');
    this.clearRecovery();this.currentSessionKey=null;++this.sessionEpoch;this.set({...this.state});
    const { error } = await this.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error('No se pudo iniciar sesión. Revisa tus datos y que el correo esté confirmado.');
    await this.validate();
  }

  async requestPasswordRecovery(email: string, redirectTo: string) {
    if (!this.auth) throw new Error('El acceso aún no está configurado.');
    const { error } = await this.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    if (error) throw new Error(error.message.toLowerCase().includes('rate limit') ? 'Límite temporal de correos alcanzado. Intenta más tarde.' : 'No se pudo enviar el correo de recuperación. Intenta más tarde.');
  }

  async completePasswordRecovery(password: string) {
    const grant=this.recoveryGrant;
    if (!this.auth || !this.hasRecovery() || !grant || this.recovering || this.state.status !== 'signedIn' || this.state.user?.id!==grant.userId) throw new Error('El enlace de recuperación no es válido o ha caducado.');
    this.recovering=true;
    const sessionEpoch=this.sessionEpoch;
    const current=()=>this.recoveryGrant===grant && this.sessionEpoch===sessionEpoch && this.currentSessionKey===grant.sessionKey && this.hasRecovery() && this.state.status==='signedIn' && this.state.user?.id===grant.userId;
    try{
    // A recovery event alone is insufficient: validate the active session with Auth first.
    let verified;
    try{verified=await this.auth.getUser();}catch{
      if(current()){++this.revision;this.set({status:'signedOut',user:null,error:'No se pudo verificar la sesión de recuperación.'});}
      throw new Error('No se pudo verificar la sesión de recuperación.');
    }
    if(!current())throw new Error('La sesión de recuperación cambió o ha caducado.');
    const {data,error:sessionError}=verified;
    if (sessionError || !data.user || data.user.is_anonymous || data.user.id !== grant.userId){
      ++this.revision;this.set({status:'signedOut',user:null,error:'No se pudo verificar la sesión de recuperación.'});
      throw new Error('No se pudo verificar la sesión de recuperación.');
    }
    const { error } = await this.auth.updateUser({ password });
    if (error) throw new Error('No se pudo actualizar la contraseña. Intenta de nuevo.');
    this.consumedRecoveries.set(grant.sessionKey,grant.expiresAt);
    // Expiry invalidates permission for a new update, not cleanup of a successful
    // update already sent. Do not sign out a different user's/new session.
    if(this.sessionEpoch!==sessionEpoch || this.currentSessionKey!==grant.sessionKey || (this.state.user && this.state.user.id!==grant.userId))throw new Error('La sesión cambió durante la actualización. No se puede confirmar el flujo de recuperación.');
    this.clearRecovery();
    if(!await this.signOut())throw new PasswordRecoverySignOutError();
    }finally{this.recovering=false;}
  }

  async signOut() {
    if (!this.auth || this.loggingOut) return false;
    this.clearRecovery();this.currentSessionKey=null;++this.sessionEpoch;
    this.loggingOut = true;
    ++this.revision;
    this.set({ status: 'loading', user: null, error: null });
    try {
      const { error } = await this.auth.signOut({ scope: 'local' });
      if (error) throw error;
      this.set({ status: 'signedOut', user: null, error: null });
      return true;
    } catch {
      this.set({ status: 'signOutError', user: null, error: 'No se pudo confirmar el cierre de sesión. Reintenta el cierre de sesión.' });
      return false;
    } finally { this.loggingOut = false; }
  }
}
