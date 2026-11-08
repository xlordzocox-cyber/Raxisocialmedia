import type { CampaignEligibility } from './campaignEligibility';
import { ideaChannelLabel } from '../ideas/ideaPresentation';
import { strategyFormatLabel } from './strategyPresentation';

export function CampaignEligibilityPanel({ result }: { result?: CampaignEligibility }) {
  return <section className="campaign-session-warning" aria-label="Elegibilidad para trabajo supervisado">
    <h5>Elegibilidad para trabajo supervisado</h5>
    <p><strong>{result?.eligible ? 'Elegible para preparar una solicitud futura' : 'Bloqueada'}</strong></p>
    <p>{result?.reason ?? 'No hay una lectura canónica confirmada y vigente del workspace.'}</p>
    {result?.revision !== undefined && <p>Strategy · revisión {result.revision}</p>}
    {!!result?.deliverables.length && <ul>
      {result.deliverables.map(({ deliverable, eligible }) => <li key={deliverable.id}>
        {deliverable.id} · {ideaChannelLabel[deliverable.channel]} · {strategyFormatLabel[deliverable.format]} · {eligible
          ? 'Dentro del alcance'
          : 'Fuera del alcance inicial de foto pública en Instagram Feed'}
      </li>)}
    </ul>}
    <p>La ejecución y el gasto requieren autorización humana independiente. Aria Studio es el proveedor visual previsto.</p>
  </section>;
}
