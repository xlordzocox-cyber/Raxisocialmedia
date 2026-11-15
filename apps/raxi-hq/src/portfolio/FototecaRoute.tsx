import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../auth/client';
import { FototecaPage } from './FototecaPage';

export default function FototecaRoute() {
  const { user } = useAuth();
  if (!supabase || !user) return <main className="fototeca"><p role="alert">La Fototeca necesita una sesión conectada a Supabase.</p></main>;
  return <FototecaPage key={user.id} client={supabase} ownerId={user.id} />;
}
