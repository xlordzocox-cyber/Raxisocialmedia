import { useRef, useState } from 'react';
import type { IdeaRecord } from '../ideas/ideaContracts';
import { summarizeIdeas } from '../ideas/ideaSelectors';
import { IdeaCenterPanel } from '../ideas/IdeaCenterPanel';
import { createIdeaCenterSession, dispatchIdeaAction, sessionIdeas, type Clock, type IdeaCenterSession, type IdeaSessionCommand } from '../ideas/ideaCenterSession';
import { OperationsInbox } from '../operations/OperationsInbox';
import { CampaignWorkspace } from '../campaigns/CampaignWorkspace';
import { createCampaignSession, dispatchCampaignAction, type CampaignCommand, type CampaignSession } from '../campaigns/campaignSession';

const IDEA_PANEL_ID = 'idea-center-panel';
const OPERATIONS_INBOX_ID = 'operations-inbox';
const CAMPAIGN_WORKSPACE_ID = 'campaign-workspace';
const runtimeClock: Clock = () => new Date().toISOString();

function OperationsBuilding() {
  return <svg viewBox="0 0 220 150" aria-hidden="true" focusable="false">
    <ellipse cx="111" cy="129" rx="99" ry="15" fill="#030910" opacity=".65" />
    <path d="M11 113 111 69 209 111 110 147Z" fill="#11324a" stroke="#3b7892" strokeWidth="2" />
    <path d="M39 68 110 38 181 67 110 98Z" fill="#29465c" stroke="#65dcf0" strokeWidth="2" />
    <path d="M39 68 110 98 110 133 39 101Z" fill="#152c42" stroke="#528ca2" strokeWidth="2" />
    <path d="M110 98 181 67 181 101 110 133Z" fill="#1c3c51" stroke="#528ca2" strokeWidth="2" />
    <path d="M56 82 72 89 72 101 56 94ZM82 94 98 101 98 113 82 106ZM123 104 139 97 139 109 123 116ZM148 93 164 86 164 98 148 105Z" fill="#42d8ef" opacity=".72" />
    <path d="M84 49 110 38 136 49 110 61Z" fill="#336a79" />
    <path d="M109 38V20" stroke="#90eaf4" strokeWidth="2" /><circle cx="109" cy="18" r="5" fill="#9cefff" />
    <path d="M21 116 110 78 199 115" fill="none" stroke="#43c8e0" opacity=".38" />
  </svg>;
}

export function IdeasBuilding() {
  return <svg viewBox="0 0 220 150" aria-hidden="true" focusable="false">
    <ellipse cx="110" cy="130" rx="96" ry="15" fill="#030910" opacity=".7" />
    <path d="M13 113 108 72 207 112 110 147Z" fill="#2c2453" stroke="#8673c7" strokeWidth="2" />
    <path d="M52 69 110 44 169 68 110 94Z" fill="#62539a" stroke="#c2a9ff" strokeWidth="2" />
    <path d="M52 69 110 94 110 132 52 106Z" fill="#352b63" stroke="#a38cda" strokeWidth="2" />
    <path d="M110 94 169 68 169 105 110 132Z" fill="#433775" stroke="#a38cda" strokeWidth="2" />
    <path d="M68 82 82 88 82 99 68 93ZM90 92 103 98 103 109 90 103ZM119 99 132 93 132 105 119 111ZM140 89 153 83 153 95 140 101Z" fill="#96edf9" opacity=".8" />
    <path d="M88 51V33l22-10 22 10v18L110 61Z" fill="#846cc7" stroke="#dfc7ff" strokeWidth="2" />
    <path d="M96 34 110 28 124 34 110 41Z" fill="#d6b8ff" opacity=".75" />
    <path d="M110 23V13" stroke="#d9c5ff" strokeWidth="2" /><circle cx="110" cy="10" r="5" fill="#f0dcff" />
    <circle cx="110" cy="10" r="13" fill="none" stroke="#c4a5ff" opacity=".38" />
    <path d="M28 112 110 77 192 113" fill="none" stroke="#ae8ef1" opacity=".5" />
  </svg>;
}

export function CampusOverview({ ideas, clock = runtimeClock }: { ideas: readonly IdeaRecord[]; clock?: Clock }) {
  const [open, setOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>();
  const selectedCampaignIdRef = useRef<string | undefined>(undefined);
  const selectCampaign = (id: string) => { selectedCampaignIdRef.current = id; setSelectedCampaignId(id); };
  const sessionRef = useRef<IdeaCenterSession | null>(null);
  if (sessionRef.current === null) sessionRef.current = createIdeaCenterSession(ideas);
  const [session, setSession] = useState(sessionRef.current);
  const campaignsRef = useRef<CampaignSession | null>(null);
  if (campaignsRef.current === null) campaignsRef.current = createCampaignSession();
  const [campaigns, setCampaigns] = useState(campaignsRef.current);
  const [actionError, setActionError] = useState<string>();
  const apply = (action: IdeaSessionCommand): boolean => {
    try {
      const next = dispatchIdeaAction(sessionRef.current!, clock, action);
      sessionRef.current = next;
      setSession(next);
      setActionError(undefined);
      return true;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Acción inválida.');
      return false;
    }
  };
  const applyCampaign = (action: CampaignCommand): boolean => {
    try {
      const next = dispatchCampaignAction(campaignsRef.current!, sessionRef.current!.handoffs, clock, action);
      campaignsRef.current = next;
      setCampaigns(next);
      if (action.type === 'CREATE_CAMPAIGN') {
        selectCampaign(next.campaigns[next.campaigns.length - 1].id);
        setWorkspaceOpen(true);
      }
      setActionError(undefined);
      return true;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Acción de campaña inválida.');
      return false;
    }
  };
  const visibleIdeas = sessionIdeas(session);
  const summary = summarizeIdeas(visibleIdeas);
  return <section className="campus" aria-label="Raxi HQ Campus">
    <div className="campus-heading"><div><span className="campus-eyebrow">RAXI HQ CAMPUS</span><h2>Un lugar para operar y pensar lo que sigue.</h2></div><span className="campus-phase">v0.8 · Producción Aria</span></div>
    <div className="campus-buildings">
      <button type="button" className="campus-building campus-building--operations" aria-label="Abrir bandeja del Centro de Operaciones" aria-expanded={inboxOpen} aria-controls={OPERATIONS_INBOX_ID} onClick={() => setInboxOpen(value => !value)}>
        <div className="campus-art"><OperationsBuilding /></div>
        <div className="campus-building-copy"><span className="campus-building-kicker"><i aria-hidden="true" /> ACTIVO · OFFICE v0.5</span><strong>Centro de<br />Operaciones</strong><span className="campus-building-description">Decisiones HQ · campañas internas</span><span className="campus-telemetry"><span><b>{session.handoffs.length}</b> propuestas internas recibidas</span><span><b>{campaigns.campaigns.length}</b> campañas de sesión</span></span><span className="campus-building-footer">{inboxOpen ? 'Cerrar bandeja' : 'Abrir bandeja'} <span aria-hidden="true">{inboxOpen ? '↑' : '↗'}</span></span></div>
      </button>
      <button type="button" className="campus-building campus-building--ideas" aria-expanded={open} aria-controls={IDEA_PANEL_ID} onClick={() => setOpen(current => !current)}>
        <span className="campus-art"><IdeasBuilding /></span>
        <span className="campus-building-copy"><span className="campus-building-kicker"><i aria-hidden="true" /> CENTRO DE IDEAS · MOCK + SESIÓN LOCAL</span><strong>Centro de<br />Ideas</strong><span className="campus-building-description">Radar y captura local de propuestas</span><span className="campus-telemetry"><span><b>{summary.totalIdeas}</b> {summary.totalIdeas === 1 ? 'idea' : 'ideas'}</span><span><b>{session.manualDrafts.length}</b> borradores locales</span><span><b>{summary.underReviewCount}</b> en análisis</span><span><b>{summary.approvedForHqCount}</b> {summary.approvedForHqCount === 1 ? 'lista' : 'listas'} para HQ</span></span><span className="campus-building-footer">{open ? 'Cerrar panel' : 'Explorar ideas'} <span aria-hidden="true">{open ? '↑' : '↗'}</span></span></span>
      </button>
    </div>
    <div className="campaign-workspace-link"><button type="button" aria-expanded={workspaceOpen} aria-controls={CAMPAIGN_WORKSPACE_ID} onClick={() => setWorkspaceOpen(value => !value)}>{workspaceOpen ? 'Cerrar Campaign Workspace' : 'Abrir Campaign Workspace'} · {campaigns.campaigns.length}</button></div>
    {actionError && <p className="idea-form-error" role="alert">{actionError}</p>}
    <OperationsInbox id={OPERATIONS_INBOX_ID} handoffs={session.handoffs} open={inboxOpen} campaigns={campaigns} onAction={applyCampaign} onOpenCampaign={id => { selectCampaign(id); setWorkspaceOpen(true); }} />
    <CampaignWorkspace id={CAMPAIGN_WORKSPACE_ID} session={campaigns} getSession={() => campaignsRef.current!}
      open={workspaceOpen} selectedId={selectedCampaignId} getSelectedId={() => selectedCampaignIdRef.current}
      onSelect={selectCampaign} onAction={applyCampaign} />
    <IdeaCenterPanel id={IDEA_PANEL_ID} ideas={visibleIdeas} open={open} session={session} onAction={apply} error={actionError} />
  </section>;
}
