import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { AuthStore } from './authStore';

const AuthContext = createContext<AuthStore | null>(null);
export function AuthProvider({ store, children }: { store: AuthStore; children: ReactNode }) {
  useEffect(() => store.start(), [store]);
  return <AuthContext.Provider value={store}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const store = useContext(AuthContext);
  if (!store) throw new Error('AuthProvider is required');
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...state, signIn: store.signIn.bind(store), signOut: store.signOut.bind(store), getRealIdeaStore: store.getRealIdeaStore };
}
