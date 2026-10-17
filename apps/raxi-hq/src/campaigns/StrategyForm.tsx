import { useState } from 'react';
import type { CampaignRecord } from './campaignContracts';
import type { CampaignStrategyInput, CampaignStrategyRevision, StrategyDeliverable, StrategyFormat } from './strategyContracts';
import { STRATEGY_FORMATS } from './strategyContracts';
import { MAX_STRATEGY_ROWS } from './strategyValidation';
import { compatibleLevels, strategyFormatLabel } from './strategyPresentation';
import { ideaChannelLabel } from '../ideas/ideaPresentation';
import { contentLevelLabel } from './campaignPresentation';

const fields = [
  ['audience', 'Audiencia objetivo'], ['audienceNeed', 'Interés o necesidad de la audiencia'],
  ['creativeConcept', 'Concepto creativo'], ['narrativeApproach', 'Enfoque narrativo'],
  ['visualDirection', 'Dirección visual'], ['toneOfVoice', 'Tono de voz'],
  ['desiredAudienceResponse', 'Respuesta esperada'], ['successCriteria', 'Criterios de éxito'],
] as const;
type TextField = typeof fields[number][0];
const blank = (): Record<TextField, string> => ({ audience: '', audienceNeed: '', creativeConcept: '', narrativeApproach: '',
  visualDirection: '', toneOfVoice: '', desiredAudienceResponse: '', successCriteria: '' });
function nextRow(rows: readonly StrategyDeliverable[], campaign: CampaignRecord): StrategyDeliverable {
  const channel = campaign.channels.find(item => compatibleLevels(item, campaign.contentLevels).length > 0) ?? campaign.channels[0];
  const contentLevel = compatibleLevels(channel, campaign.contentLevels)[0] ?? campaign.contentLevels[0];
  const used = new Set(rows.map(row => row.id));
  let number = 1;
  while (used.has(`STRATEGY-ITEM-${String(number).padStart(3, '0')}`)) number++;
  return { id: `STRATEGY-ITEM-${String(number).padStart(3, '0')}`, channel, contentLevel,
    format: 'PHOTO', quantity: 1, purpose: '', creativeAngle: '' };
}
export function StrategyForm({ campaign, revision, onSave }: {
  campaign: CampaignRecord; revision?: CampaignStrategyRevision; onSave: (input: CampaignStrategyInput) => boolean;
}) {
  const eligibleChannels = campaign.channels.filter(channel => compatibleLevels(channel, campaign.contentLevels).length > 0);
  const [text, setText] = useState<Record<TextField, string>>(() => revision ? Object.fromEntries(fields.map(([key]) => [key, revision[key]])) as Record<TextField, string> : blank());
  const [notes, setNotes] = useState(revision?.notes ?? '');
  const [rows, setRows] = useState<StrategyDeliverable[]>(() => revision?.deliverables.map(row => ({ ...row })) ?? [nextRow([], campaign)]);
  const [saved, setSaved] = useState(false);
  const updateRow = (id: string, patch: Partial<StrategyDeliverable>) => {
    setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row));
    setSaved(false);
  };
  if (eligibleChannels.length === 0) return <p role="alert">El Campaign Brief no tiene una combinación compatible de canal y nivel editorial. No se puede crear una matriz válida con este brief.</p>;
  return <form className="strategy-form idea-form" aria-label="Estrategia editorial" onSubmit={event => {
    event.preventDefault();
    setSaved(onSave({ ...text, deliverables: rows, notes: notes || undefined }));
  }}>
    <h5>Plan editorial · revisión {revision?.revision ?? 1}</h5>
    <p className="idea-form-hint">Escribe decisiones y criterios reales de Luis. Las piezas son propuestas de producción, no assets existentes.</p>
    {fields.map(([key, label]) => <label key={key} className="campaign-wide">{label}<textarea required rows={2} maxLength={1500} value={text[key]} onChange={event => { setText(current => ({ ...current, [key]: event.target.value })); setSaved(false); }} /></label>)}
    <label className="campaign-wide">Notas opcionales<textarea rows={2} maxLength={2000} value={notes} onChange={event => { setNotes(event.target.value); setSaved(false); }} /></label>
    <fieldset className="strategy-matrix"><legend>Matriz de entregables planificados · máximo 12 filas / 30 piezas</legend>
      {rows.map(row => <div className="strategy-row" key={row.id}>
        <strong>{row.id}</strong>
        <label>Canal<select value={row.channel} onChange={event => {
          const channel = event.target.value as StrategyDeliverable['channel'];
          updateRow(row.id, { channel, contentLevel: compatibleLevels(channel, campaign.contentLevels)[0] ?? row.contentLevel });
        }}>{eligibleChannels.map(channel => <option key={channel} value={channel}>{ideaChannelLabel[channel]}</option>)}</select></label>
        <label>Nivel editorial<select value={row.contentLevel} onChange={event => updateRow(row.id, { contentLevel: event.target.value as StrategyDeliverable['contentLevel'] })}>{compatibleLevels(row.channel, campaign.contentLevels).map(level => <option key={level} value={level}>{contentLevelLabel[level]}</option>)}</select></label>
        <label>Formato<select value={row.format} onChange={event => updateRow(row.id, { format: event.target.value as StrategyFormat })}>{STRATEGY_FORMATS.map(format => <option key={format} value={format}>{strategyFormatLabel[format]}</option>)}</select></label>
        <label>Cantidad<input type="number" min={1} max={30} step={1} required value={row.quantity} onChange={event => updateRow(row.id, { quantity: Number(event.target.value) })} /></label>
        <label>Propósito<textarea required maxLength={500} rows={2} value={row.purpose} onChange={event => updateRow(row.id, { purpose: event.target.value })} /></label>
        <label>Enfoque creativo<textarea required maxLength={500} rows={2} value={row.creativeAngle} onChange={event => updateRow(row.id, { creativeAngle: event.target.value })} /></label>
        <button type="button" onClick={() => { setRows(current => current.filter(item => item.id !== row.id)); setSaved(false); }} disabled={rows.length === 1}>Quitar fila</button>
      </div>)}
      <button type="button" disabled={rows.length >= MAX_STRATEGY_ROWS} onClick={() => { setRows(current => [...current, nextRow(current, campaign)]); setSaved(false); }}>Añadir entregable</button>
    </fieldset>
    <div className="idea-form-actions"><button type="submit">Guardar estrategia local</button>{saved && <span role="status">Borrador guardado en esta sesión.</span>}</div>
  </form>;
}
