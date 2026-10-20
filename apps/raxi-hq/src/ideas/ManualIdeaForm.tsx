import { useState, type FormEvent } from 'react';
import { IDEA_PRIORITIES, type IdeaPriority } from './ideaContracts';
import { ideaPriorityLabel } from './ideaPresentation';
import type { ManualIdeaInput } from './manualIdeaDraft';

export function ManualIdeaForm({ onSave, onCancel, pending = false, real = false }: { onSave: (input: ManualIdeaInput) => void; onCancel: () => void; pending?: boolean; real?: boolean }) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [priority, setPriority] = useState<IdeaPriority>('MEDIUM');
  const [sourceRef, setSourceRef] = useState('');
  const submit = (event: FormEvent) => { event.preventDefault(); if (!pending) onSave({ title, note, priority, sourceRef: sourceRef || undefined }); };
  return <form className="idea-form" aria-label="Nueva idea de Luis" onSubmit={submit}>
    <h4>Nueva idea</h4>
    <fieldset className="manual-idea-fields" disabled={pending}>
    <label>Título<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label>Idea / nota<textarea required maxLength={1000} rows={3} value={note} onChange={event => setNote(event.target.value)} /></label>
    <label>Prioridad<select value={priority} onChange={event => setPriority(event.target.value as IdeaPriority)}>{IDEA_PRIORITIES.map(value => <option key={value} value={value}>{ideaPriorityLabel[value]}</option>)}</select></label>
    <label>Referencia opcional<input maxLength={256} value={sourceRef} onChange={event => setSourceRef(event.target.value)} /></label>
    <p className="idea-form-hint">La referencia se guarda como texto; no se abre ni consulta.</p>
    <div className="idea-form-actions"><button type="submit">{pending ? 'Guardando…' : real ? 'Guardar idea real' : 'Guardar borrador'}</button>{!real && <button type="button" onClick={onCancel}>Cancelar</button>}</div>
    </fieldset>
  </form>;
}
