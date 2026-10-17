import { useState } from 'react';
import { IDEA_CHANNELS, IDEA_PRIORITIES, type IdeaChannel, type IdeaPriority } from '../ideas/ideaContracts';
import type { IdeaHandoffToHQ } from '../ideas/ideaContracts';
import { ideaChannelLabel, ideaPriorityLabel } from '../ideas/ideaPresentation';
import { CAMPAIGN_CONTENT_LEVELS, type CampaignBriefInput, type CampaignContentLevel } from './campaignContracts';
import { contentLevelLabel } from './campaignPresentation';

export function CampaignBriefForm({ handoff, onCreate, onCancel }: { handoff: IdeaHandoffToHQ; onCreate: (brief: CampaignBriefInput) => boolean; onCancel: () => void }) {
  const [title, setTitle] = useState(handoff.title);
  const [objective, setObjective] = useState('');
  const [priority, setPriority] = useState<IdeaPriority>(handoff.priority);
  const [channels, setChannels] = useState<IdeaChannel[]>(handoff.suggestedChannels);
  const [contentLevels, setContentLevels] = useState<CampaignContentLevel[]>([]);
  const [keyMessage, setKeyMessage] = useState('');
  const [cta, setCta] = useState('');
  const [notes, setNotes] = useState('');
  const [confirm, setConfirm] = useState(false);
  const toggle = <T extends string,>(items: T[], item: T, set: (value: T[]) => void) => set(items.includes(item) ? items.filter(value => value !== item) : [...items, item]);
  const input: CampaignBriefInput = { title, objective, priority, channels, contentLevels, keyMessage,
    cta: cta || undefined, notes: notes || undefined };
  return <form className="campaign-brief idea-form" aria-label="Campaign Brief" onSubmit={event => {
    event.preventDefault();
    if (!confirm) { setConfirm(true); return; }
    if (onCreate(input)) setConfirm(false);
  }}>
    <h4>Campaign Brief · {handoff.ideaId}</h4>
    <p className="idea-form-hint">Luis confirma el contexto editorial antes de crear una campaña interna. Nada se envía fuera del HQ.</p>
    <label>Título<input required maxLength={120} value={title} onChange={event => { setTitle(event.target.value); setConfirm(false); }} /></label>
    <label>Prioridad<select value={priority} onChange={event => { setPriority(event.target.value as IdeaPriority); setConfirm(false); }}>{IDEA_PRIORITIES.map(value => <option key={value} value={value}>{ideaPriorityLabel[value]}</option>)}</select></label>
    <label className="campaign-wide">Objetivo<textarea required rows={3} maxLength={1500} value={objective} onChange={event => { setObjective(event.target.value); setConfirm(false); }} /></label>
    <fieldset><legend>Canales · sugerencia heredada de la propuesta; confirma o modifica</legend><div className="idea-form-checks">{IDEA_CHANNELS.map(channel => <label key={channel}><input type="checkbox" checked={channels.includes(channel)} onChange={() => { toggle(channels, channel, setChannels); setConfirm(false); }} />{ideaChannelLabel[channel]}</label>)}</div></fieldset>
    <fieldset><legend>Nivel editorial · elige al menos uno, distinto de los canales</legend><div className="idea-form-checks">{CAMPAIGN_CONTENT_LEVELS.map(level => <label key={level}><input type="checkbox" checked={contentLevels.includes(level)} onChange={() => { toggle(contentLevels, level, setContentLevels); setConfirm(false); }} />{contentLevelLabel[level]}</label>)}</div></fieldset>
    <label className="campaign-wide">Mensaje clave<textarea required rows={3} maxLength={1500} value={keyMessage} onChange={event => { setKeyMessage(event.target.value); setConfirm(false); }} /></label>
    <label className="campaign-wide">CTA opcional<textarea rows={2} maxLength={500} value={cta} onChange={event => { setCta(event.target.value); setConfirm(false); }} /></label>
    <label className="campaign-wide">Notas opcionales<textarea rows={3} maxLength={2000} value={notes} onChange={event => { setNotes(event.target.value); setConfirm(false); }} /></label>
    {confirm && <p className="campaign-confirm">Confirmar creación de una campaña DRAFT solo durante esta sesión. Esta acción aceptará la propuesta.</p>}
    <div className="idea-form-actions"><button type="submit">{confirm ? 'Crear campaña interna' : 'Revisar y confirmar brief'}</button><button type="button" onClick={onCancel}>Cancelar</button></div>
  </form>;
}
