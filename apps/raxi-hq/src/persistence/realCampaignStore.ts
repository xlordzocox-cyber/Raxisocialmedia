import type { SupabaseClient } from '@supabase/supabase-js';
import { applyCampaignOperation, parseCampaignSnapshot, sameValue, type CampaignOperation, type CampaignSnapshot, type RealCampaignAction } from './campaignCommands';
export interface CampaignRepository { read(workspace: string): Promise<unknown>; execute(command: CampaignOperation): Promise<unknown> }
export interface RealCampaignState { phase: 'loading' | 'ready' | 'saving' | 'error' | 'unavailable'; snapshot: CampaignSnapshot | null; error: string | null; confirmedId: string | null; pending: CampaignOperation | null }
export class RealCampaignStore {
  private state: RealCampaignState = { phase: 'loading', snapshot: null, error: null, confirmedId: null, pending: null };
  private generation = 0;
  private retired = false;
  private active = false;
  private listeners = new Set<() => void>();
  constructor(private repository: CampaignRepository, private owner: string, private workspace: string, private uuid = () => crypto.randomUUID()) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(next: RealCampaignState) { this.state = next; this.listeners.forEach(fn => fn()); }
  dispose() { this.retired = true; ++this.generation; this.set({ phase: 'loading', snapshot: null, error: null, confirmedId: null, pending: null }); }
  async resume() { if (this.state.phase === 'loading' || this.state.pending || this.state.phase === 'error') await this.load(); }
  async load() {
    if (this.retired || this.active) return;
    const generation = ++this.generation;
    this.set({ ...this.state, phase: 'loading', error: null });
    try {
      const snapshot = parseCampaignSnapshot(await this.repository.read(this.workspace), this.owner, this.workspace);
      if (generation !== this.generation) return;
      const pending = this.state.pending;
      const receipt = pending && snapshot.receipts.find(r => r.operationId === pending.operationId);
      if (receipt && !sameValue(receipt.command, pending)) throw new Error('Conflicto verificable en el recibo de la operación pendiente.');
      this.set({ phase: 'ready', snapshot, pending: receipt ? null : pending, confirmedId: receipt ? receipt.operationId : this.state.confirmedId, error: null });
    } catch (cause) { if (generation === this.generation) this.set({ ...this.state, phase: cause instanceof Error && cause.message === 'SERVICE_NOT_DEPLOYED' ? 'unavailable' : 'error', error: cause instanceof Error ? cause.message : 'Lectura no confirmada.' }); }
  }
  async execute(action: RealCampaignAction): Promise<boolean> {
    if (this.retired || this.active || !this.state.snapshot || !['ready', 'error'].includes(this.state.phase)) return false;
    if (this.state.pending && !sameValue(this.state.pending.action, action)) { this.set({ ...this.state, error: 'Hay una operación pendiente. Recupérala o reinténtala con sus datos originales.' }); return false; }
    const command = this.state.pending ?? { workspaceId: this.workspace, expectedVersion: this.state.snapshot.version, operationId: this.uuid(), action: structuredClone(action) };
    try { applyCampaignOperation(this.state.snapshot, command); }
    catch (cause) { this.set({ ...this.state, phase: 'error', error: cause instanceof Error ? cause.message : 'Comando inválido.' }); return false; }
    const generation = this.generation; this.active = true;
    this.set({ ...this.state, phase: 'saving', error: null, confirmedId: null, pending: command });
    try {
      const snapshot = parseCampaignSnapshot(await this.repository.execute(command), this.owner, this.workspace);
      if (generation !== this.generation) return false;
      const receipt = snapshot.receipts.find(r => r.operationId === command.operationId);
      if (!receipt || !sameValue(receipt.command, command) || snapshot.version < command.expectedVersion + 1) throw new Error('No existe confirmación canónica de esta operación.');
      this.set({ phase: 'ready', snapshot, pending: null, confirmedId: command.operationId, error: null }); return true;
    } catch (cause) { if (generation === this.generation) this.set({ ...this.state, phase: 'error', error: cause instanceof Error ? cause.message : 'Guardado no confirmado.' }); return false; }
    finally { if (generation === this.generation) this.active = false; }
  }
  retry = () => this.state.pending ? this.execute(this.state.pending.action) : Promise.resolve(false);
  canReconsider = () => !this.retired && !this.active && !!this.state.pending && !!this.state.snapshot &&
    this.state.snapshot.version > this.state.pending.expectedVersion && !this.state.snapshot.receipts.some(r => r.operationId === this.state.pending!.operationId);
  reconsider() {
    // A higher committed CAS version and no receipt prove this old command cannot commit later.
    if (this.canReconsider()) this.set({ ...this.state, phase: 'ready', pending: null, error: 'La operación obsoleta no se aplicó. Revisa y confirma de nuevo sobre la versión actual.' });
  }
}
export function createCampaignRepository(client: SupabaseClient): CampaignRepository {
  return {
    async read(workspace) { const { data, error } = await client.rpc('raxi_campaign_snapshot', { p_workspace: workspace }); if (error) throw new Error(error.code === 'PGRST202' ? 'SERVICE_NOT_DEPLOYED' : 'No se pudo recuperar el workspace de campañas.'); return data; },
    async execute(command) { const { data, error } = await client.functions.invoke('campaign-command', { body: command }); if (error) throw new Error('El servidor no confirmó el guardado. Conservamos la operación para reintentar.'); return data; },
  };
}
