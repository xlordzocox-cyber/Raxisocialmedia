import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../auth/client';
import { AgenciaPage } from './AgenciaPage';

export default function AgenciaRoute() {
  const { user } = useAuth();
  if (!supabase || !user) return <main className="agency-main"><p role="alert">La agencia necesita una sesión conectada a Supabase.</p></main>;
  return <AgenciaPage key={user.id} client={supabase} ownerId={user.id} />;
}
