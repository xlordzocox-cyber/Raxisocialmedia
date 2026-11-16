import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../auth/client';
import { MultimediaPage } from './MultimediaPage';

export default function MultimediaRoute() {
  const { user } = useAuth();
  if (!supabase || !user) return <main className="fototeca"><p role="alert">Multimedia necesita una sesión conectada a Supabase.</p></main>;
  return <MultimediaPage key={user.id} client={supabase} ownerId={user.id} />;
}
