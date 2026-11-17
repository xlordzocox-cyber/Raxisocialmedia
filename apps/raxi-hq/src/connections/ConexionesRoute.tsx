import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../auth/client';
import { ConexionesPage } from './ConexionesPage';

export default function ConexionesRoute() {
  const { user } = useAuth();
  if (!supabase || !user) return <main className="conexiones"><p role="alert">Conexiones necesita una sesión conectada a Supabase.</p></main>;
  return <ConexionesPage key={user.id} client={supabase} ownerId={user.id} />;
}
