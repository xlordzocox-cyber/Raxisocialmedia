import { useState, type FormEvent } from 'react';
import { IDEA_CHANNELS, IDEA_PRIORITIES, type IdeaChannel, type IdeaPriority } from './ideaContracts';
import { ideaChannelLabel, ideaPriorityLabel } from './ideaPresentation';
import type { IdeaReviewInput } from './ideaCenterSession';
import type { ManualIdeaDraft } from './manualIdeaDraft';

export function IdeaReviewForm({ draft, onSave, onCancel }: { draft: ManualIdeaDraft; onSave: (input: IdeaReviewInput) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(draft.title);
  const [summary, setSummary] = useState(draft.note);
  const [reason, setReason] = useState('');
  const [priority, setPriority] = useState<IdeaPriority>(draft.priority);
  const [channels, setChannels] = useState<IdeaChannel[]>([]);
  const [tags, setTags] = useState('');
  const [fit, setFit] = useState('');
  const [confidence, setConfidence] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ title, summary, reason, priority, suggestedChannels: channels,
      tags: tags ? tags.split(',').map(tag => tag.trim()) : [], fitScore: fit === '' ? Number.NaN : Number(fit),
      confidenceScore: confidence === '' ? Number.NaN : Number(confidence) });
  };
  return <form className="idea-form" aria-label="Preparar propuesta" onSubmit={submit}>
    <h4>Preparar propuesta · {draft.id}</h4>
    {draft.sourceRef && <p className="idea-form-reference">Referencia original: <code>{draft.sourceRef}</code></p>}
    <label>Título<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label>Resumen<textarea required maxLength={1000} rows={3} value={summary} onChange={event => setSummary(event.target.value)} /></label>
    <label>Motivo<textarea required maxLength={1500} rows={3} value={reason} onChange={event => setReason(event.target.value)} /></label>
    <label>Prioridad<select value={priority} onChange={event => setPriority(event.target.value as IdeaPriority)}>{IDEA_PRIORITIES.map(value => <option key={value} value={value}>{ideaPriorityLabel[value]}</option>)}</select></label>
    <fieldset><legend>Canales sugeridos</legend><div className="idea-form-checks">{IDEA_CHANNELS.map(channel => <label key={channel}><input type="checkbox" checked={channels.includes(channel)} onChange={event => setChannels(current => event.target.checked ? [...current, channel] : current.filter(value => value !== channel))} /> {ideaChannelLabel[channel]}</label>)}</div></fieldset>
    <label>Tags (separados por comas)<input value={tags} onChange={event => setTags(event.target.value)} /></label>
    <div className="idea-form-scores"><label>Afinidad con Raxi (0–100)<input type="number" required min="0" max="100" step="1" value={fit} onChange={event => setFit(event.target.value)} /></label><label>Confianza (0–100)<input type="number" required min="0" max="100" step="1" value={confidence} onChange={event => setConfidence(event.target.value)} /></label></div>
    <div className="idea-form-actions"><button type="submit">Crear propuesta</button><button type="button" onClick={onCancel}>Cancelar</button></div>
  </form>;
}
