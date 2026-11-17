import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../auth/client';
import { TALENT_ROSTER } from '../agency/agencyModel';
import { NewSeriesPage, SeriesDetailPage } from './SeriesPage';

export default function SeriesRoute() {
  const { user } = useAuth();
  const { id } = useParams();
  const [params] = useSearchParams();
  if (!supabase || !user) return <main className="agency-main"><p role="alert">Las series necesitan una sesión conectada a Supabase.</p></main>;
  if (id === 'nueva') {
    const base = params.get('base'); const modelo = params.get('modelo');
    if (!base || !modelo || !(TALENT_ROSTER as readonly string[]).includes(modelo)) return <Navigate to="/fototeca" replace />;
    return <NewSeriesPage key={`${base}:${modelo}`} client={supabase} characterId={modelo} baseAssetId={base} />;
  }
  if (!id) return <Navigate to="/fototeca" replace />;
  return <SeriesDetailPage key={id} client={supabase} seriesId={id} />;
}
