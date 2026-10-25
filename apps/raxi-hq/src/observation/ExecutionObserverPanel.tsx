import type { HQState } from '../domain/hq';
import { hqStore } from '../store/hqStore';

export function ExecutionObserverPanel({ state }: { state: HQState }) {
  const observation = state.observation;
  return <section className="source-health execution-observer" aria-label="Observador de ejecuciones">
    <h2>Codex · observación de solo lectura</h2>
    <p>LIVE_READ_ONLY: desconectado. No hay un puente de eventos en vivo comprobado.</p>
    <p>Reproducción histórica de una ejecución auténtica. Cada paso es manual; no indica trabajo actual.</p>
    <div className="controls">
      <button onClick={() => void hqStore.loadHistoricalCapture()} disabled={state.mode === 'HISTORICAL_REPLAY'}>Reproducir captura histórica verificada</button>
      <button onClick={() => hqStore.nextHistoricalObservation()} disabled={!observation || observation.confirmed === 'COMPLETED'}>Mostrar finalización histórica</button>
      <button disabled>Conectar Codex en vivo · pendiente</button>
    </div>
    {observation && <dl>
      <dt>Modo</dt><dd>HISTORICAL_REPLAY · sin conexión en vivo</dd>
      <dt>Ejecutor</dt><dd>{observation.executorId}</dd>
      <dt>Ejecución</dt><dd>{observation.runId}</dd>
      <dt>Tarea Raxi / agente asignado</dt><dd>No observados · sin atribución al Director o Investigador</dd>
      <dt>Estado de origen histórico</dt><dd>{observation.confirmed} · estado actual desconocido</dd>
      <dt>Fecha del evento</dt><dd>{observation.timestamp}</dd>
      <dt>Referencia de origen</dt><dd>{observation.originRef}</dd>
      <dt>SHA-256 de la captura</dt><dd>{observation.sha256}</dd>
    </dl>}
    <p>Los desplazamientos representan estos estados pasados. Las estaciones son una convención visual, no una asignación operativa.</p>
  </section>;
}
