import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../auth/client';
import { TALENT_ROSTER } from '../agency/agencyModel';
import { SheetCreatorPage } from './SheetCreatorPage';

export default function CreadorRoute() {
  const { user } = useAuth();
  const { id } = useParams();
  if (!supabase || !user) return <main className="agency-main"><p role="alert">El creador necesita una sesión conectada a Supabase.</p></main>;
  if (!id || !(TALENT_ROSTER as readonly string[]).includes(id)) return <Navigate to="/talento" replace />;
  return <SheetCreatorPage key={`${user.id}:${id}`} client={supabase} ownerId={user.id} characterId={id} />;
}
