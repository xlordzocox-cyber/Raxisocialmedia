import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../auth/client';
import { TALENT_ROSTER } from '../agency/agencyModel';
import { TalentListPage } from './TalentListPage';
import { TalentProfilePage } from './TalentProfilePage';

export default function TalentoRoute() {
  const { user } = useAuth();
  const { id } = useParams();
  if (!supabase || !user) return <main className="agency-main"><p role="alert">Talento necesita una sesión conectada a Supabase.</p></main>;
  if (!id) return <TalentListPage />;
  if (!(TALENT_ROSTER as readonly string[]).includes(id)) return <Navigate to="/talento" replace />;
  return <TalentProfilePage key={`${user.id}:${id}`} client={supabase} ownerId={user.id} characterId={id} />;
}
