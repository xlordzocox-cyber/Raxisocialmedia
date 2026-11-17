import { NavLink } from 'react-router-dom';
import './agency.css';

export const AGENCY_SECTIONS = [
  { to: '/', label: 'Agencia' },
  { to: '/talento', label: 'Talento' },
  { to: '/fototeca', label: 'Fototeca' },
  { to: '/multimedia', label: 'Archivo' },
  { to: '/conexiones', label: 'Conexiones' },
  { to: '/estudio', label: 'Estudio en vivo' },
] as const;

/** Shared navigation for every protected page. Presentation only: no data, no writes. */
export function AgencyNav() {
  return <nav className="agency-nav" aria-label="Secciones de la agencia">
    {AGENCY_SECTIONS.map((s) => <NavLink key={s.to} to={s.to} end={s.to === '/'} className="agency-nav-link">{s.label}</NavLink>)}
  </nav>;
}
