import { Link } from 'react-router-dom';
import { AgencyNav } from '../agency/AgencyNav';
import { TALENT_ROSTER } from '../agency/agencyModel';
import { characterLabel } from '../portfolio/mediaModel';
import './talent.css';

export function TalentListPage() {
  return <div className="agency">
    <header className="agency-header"><Link to="/" className="agency-brand">Raxi HQ</Link><AgencyNav /></header>
    <main className="agency-main">
      <section className="agency-hero"><p className="agency-eyebrow">Talento</p><h1>Nuestras modelos</h1>
        <p className="agency-lead">Cada ficha guarda su identidad 360: lo que Producción debe respetar en cada foto.</p></section>
      <ul className="talent-roster">
        {TALENT_ROSTER.map((id) => <li key={id} className="agency-card"><h2 className="talent-name">{characterLabel(id)}</h2>
          <Link to={`/talento/${id}`} className="agency-action">Abrir ficha</Link></li>)}
      </ul>
    </main>
  </div>;
}
