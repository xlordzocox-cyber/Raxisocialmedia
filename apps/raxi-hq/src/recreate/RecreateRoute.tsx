import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../auth/client';
import { TALENT_ROSTER } from '../agency/agencyModel';
import { NewRecreatePage, RecreateDetailPage } from './RecreatePage';

export default function RecreateRoute() {
  const { user } = useAuth();
  const { id } = useParams();
  const [params] = useSearchParams();
  if (!supabase || !user) return <main className="agency-main"><p role="alert">Recrear necesita una sesión conectada a Supabase.</p></main>;
  if (!id) {
    const modelo = params.get('modelo') ?? 'vesper-corvus';
    if (!(TALENT_ROSTER as readonly string[]).includes(modelo)) return <Navigate to="/talento" replace />;
    return <NewRecreatePage key={modelo} client={supabase} characterId={modelo} />;
  }
  return <RecreateDetailPage key={id} client={supabase} recreationId={id} />;
}
