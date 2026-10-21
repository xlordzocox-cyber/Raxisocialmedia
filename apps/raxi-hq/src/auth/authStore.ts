import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { RealIdeaStore } from '../persistence/realIdeaStore';
import type { RealCampaignStore } from '../persistence/realCampaignStore';

type AuthApi = Pick<SupabaseClient['auth'], 'getUser' | 'onAuthStateChange' | 'signInWithPassword' | 'signOut'>;
export type AuthState = { status: 'loading' | 'signedOut' | 'signedIn' | 'unconfigured'; user: User | null; error: string | null };

export class AuthStore {
  private state: AuthState;
  private listeners = new Set<() => void>();
  private revision = 0;
  private loggingOut = false;
  private realIdeas: RealIdeaStore | null = null;
  private realCampaigns: { workspace: string; store: RealCampaignStore } | null = null;

  constructor(private auth: AuthApi | null) {
    this.state = { status: auth ? 'loading' : 'unconfigured', user: null, error: null };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: AuthState) {
    // Session ownership, independent of App/panel mount and StrictMode effect cleanup.
    if (state.status !== 'signedIn' || state.user?.id !== this.state.user?.id) {
      this.realIdeas?.dispose();
      this.realIdeas = null;
      this.realCampaigns?.store.dispose(); this.realCampaigns = null;
    }
    this.state = state; this.listeners.forEach(listener => listener());
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
    if (!this.auth || this.loggingOut) return;
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
      // Preserve an already verified user's form during a refresh; account switches clear it.
      if (event === 'SIGNED_OUT' || this.state.status !== 'signedIn' || session?.user.id !== this.state.user?.id) {
        this.set({ status: event === 'SIGNED_OUT' ? 'signedOut' : 'loading', user: null, error: null });
      }
      // Supabase Auth callbacks must not await another Auth method under its lock.
      if (event !== 'SIGNED_OUT') timer = setTimeout(() => { void this.validate(); }, 0);
    });
    void this.validate();
    const onFocus = () => { if (this.state.status === 'signedIn') void this.validate(); };
    window.addEventListener('focus', onFocus);
    return () => { ++this.revision; clearTimeout(timer); subscription.unsubscribe(); window.removeEventListener('focus', onFocus); };
  }

  async signIn(email: string, password: string) {
    if (!this.auth) throw new Error('El acceso aún no está configurado.');
    const { error } = await this.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error('No se pudo iniciar sesión. Revisa tus datos y que el correo esté confirmado.');
    await this.validate();
  }

  async signOut() {
    if (!this.auth) return;
    this.loggingOut = true;
    ++this.revision;
    this.set({ status: 'loading', user: null, error: null });
    try {
      const { error } = await this.auth.signOut({ scope: 'local' });
      if (error) throw error;
      this.set({ status: 'signedOut', user: null, error: null });
    } catch {
      this.set({ status: 'signedOut', user: null, error: 'No se pudo cerrar la sesión guardada. Reintenta el cierre de sesión.' });
    } finally { this.loggingOut = false; }
  }
}
