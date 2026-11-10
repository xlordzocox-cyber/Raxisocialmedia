import { useEffect, useRef, useState } from 'react';
import type { CampaignEligibility } from '../campaigns/campaignEligibility';
import type { CampaignSnapshot } from './campaignCommands';
import { supabase } from '../auth/client';

/** First staging pilot only; no agent creation, provider calls or publishing. */
type RequestDraft = {
  workspaceId: string; campaignId: string; strategyRevision: number;
  deliverableId: string; expectedCampaignVersion: number; requestKey: string;
  purpose: 'PREPARE_VISUAL_BRIEF';
};
type Pending = { draft: RequestDraft; hash: string | null; submitAttempted: boolean };
type Phase = 'idle' | 'checking' | 'eligible' | 'sending' | 'unknown' | 'requested';
const hashPattern = /^[0-9a-f]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const enabled = import.meta.env.VITE_RAXI_SUPERVISED_REQUESTS_ENABLED === 'true' &&
  import.meta.env.VITE_SUPABASE_URL === 'https://zvhxjindgyvtasstfjut.supabase.co';

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function SupervisedCampaignPilot({
  snapshot, eligibility, blocked,
}: {
  snapshot: CampaignSnapshot;
  eligibility: Map<string, CampaignEligibility>;
  blocked: boolean;
}) {
  const campaign = snapshot.session.campaigns.find(item => item.id === 'CAMPAIGN-001');
  const eligible = campaign && eligibility.get(campaign.id);
  const deliverables = eligible?.deliverables.filter(item => item.eligible) ?? [];
  const item = deliverables.length === 1 ? deliverables[0] : null;
  const [pending, setPending] = useState<Pending | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [confirmed, setConfirmed] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const generation = useRef(0);

  // Fence a late response when changing account/workspace or unmounting.
  useEffect(() => {
    const currentGeneration = ++generation.current;
    return () => { if (generation.current === currentGeneration) ++generation.current; };
  }, [snapshot.workspaceId, snapshot.ownerId]);

  if (!campaign) return null;

  const canPrepare = !blocked && !!eligible?.eligible && !!eligible.revision && !!item && enabled && !!supabase;
  const call = async (operation: 'preflight' | 'submit', body: object) => {
    if (!supabase) throw Error('Backend unavailable');
    const { data, error } = await supabase.functions.invoke('supervised-campaign-request', {
      body,
      headers: { 'x-raxi-operation': operation },
    });
    if (error) throw Error('Unconfirmed server response');
    const value = object(data);
    if (!value) throw Error('Unconfirmed receipt');
    return value;
  };

  const check = async () => {
    if (!canPrepare || busy.current || pending?.submitAttempted || phase === 'requested') return;
    const draft: RequestDraft = pending?.draft ?? {
      workspaceId: snapshot.workspaceId, campaignId: campaign.id, strategyRevision: eligible!.revision!,
      deliverableId: item!.deliverable.id, expectedCampaignVersion: snapshot.version,
      requestKey: crypto.randomUUID(), purpose: 'PREPARE_VISUAL_BRIEF',
    };
    busy.current = true;
    const ticket = generation.current;
    setPending({ draft, hash: null, submitAttempted: false });
    setPhase('checking'); setMessage('');
    try {
      const value = await call('preflight', draft);
      if (ticket !== generation.current) return;
      if (value.status !== 'ELIGIBLE' || typeof value.snapshotHash !== 'string' ||
          !hashPattern.test(value.snapshotHash)) throw Error('No eligible confirmation');
      setPending({ draft, hash: value.snapshotHash, submitAttempted: false });
      setConfirmed(false); setPhase('eligible');
    } catch {
      if (ticket !== generation.current) return;
      setMessage('No se pudo confirmar elegibilidad. Conservamos la misma clave de solicitud.');
      setPhase('unknown');
    } finally { busy.current = false; }
  };

  const submit = async () => {
    if (!canPrepare || busy.current || !pending?.hash || !confirmed ||
        pending.draft.expectedCampaignVersion !== snapshot.version || phase === 'requested') return;
    const command = { ...pending.draft, snapshotHash: pending.hash };
    busy.current = true;
    const ticket = generation.current;
    setPending({ ...pending, submitAttempted: true });
    setPhase('sending'); setMessage('');
    try {
      const result = await call('submit', command);
      if (ticket !== generation.current) return;
      const received = object(result.command);
      if (result.status !== 'REQUESTED' || result.authorization !== 'PENDING_HUMAN_EXECUTION_AUTH' ||
          typeof result.requestId !== 'string' || !uuidPattern.test(result.requestId) ||
          result.actorId !== snapshot.ownerId ||
          !received || received.requestKey !== command.requestKey ||
          received.snapshotHash !== command.snapshotHash ||
          received.campaignId !== 'CAMPAIGN-001' || received.deliverableId !== item!.deliverable.id) {
        throw Error('Unconfirmed request');
      }
      setReceiptId(result.requestId); setPhase('requested'); setConfirmed(false);
    } catch {
      if (ticket !== generation.current) return;
      setMessage('Resultado no confirmado. No crees otra solicitud: reintenta con la misma clave.');
      setPhase('unknown');
    } finally { busy.current = false; }
  };

  return <section className="campaign-session-warning" aria-label="Primera solicitud supervisada">
    <h5>Primera solicitud supervisada · CAMPAIGN-001</h5>
    <p>Strategy revisión {eligible?.revision ?? 'sin confirmar'} · {item?.deliverable.id ?? 'sin entregable único'}</p>
    <p>Solo registra una solicitud de brief visual. No genera imágenes, tareas ni publicaciones.</p>
    {!enabled && <p role="status">Puente supervisado no habilitado en este cliente. Permanece cerrado hasta su despliegue autorizado en staging.</p>}
    {enabled && !canPrepare && <p role="status">Bloqueado: se requiere una lectura canónica vigente y un único entregable elegible.</p>}
    {canPrepare && phase === 'idle' && <button type="button" onClick={() => { void check(); }}>Consultar elegibilidad supervisada</button>}
    {canPrepare && phase === 'checking' && <p role="status">Consultando servidor…</p>}
    {canPrepare && phase === 'eligible' && !pending?.submitAttempted && <>
      <p role="status">Elegibilidad confirmada. Esta acción todavía NO autoriza generación.</p>
      <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        Confirmo crear solamente el recibo supervisado de esta fotografía pública.</label>
      <button type="button" disabled={!confirmed} onClick={() => { void submit(); }}>Solicitar brief supervisado</button>
    </>}
    {canPrepare && phase === 'sending' && <p role="status">Esperando recibo de PostgreSQL…</p>}
    {phase === 'unknown' && <>
      <p role="alert">{message}</p>
      {canPrepare && pending?.submitAttempted && pending.hash && <button type="button" onClick={() => { void submit(); }}>Reintentar MISMA solicitud</button>}
      {canPrepare && !pending?.submitAttempted && <button type="button" onClick={() => { void check(); }}>Reconsultar misma clave</button>}
    </>}
    {phase === 'requested' && receiptId && <p role="status">Solicitud registrada · recibo {receiptId}. Pendiente de autorización humana independiente.</p>}
  </section>;
}
