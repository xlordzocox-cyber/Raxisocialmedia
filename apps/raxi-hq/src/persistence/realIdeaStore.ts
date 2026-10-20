import type { IdeaRecord } from '../ideas/ideaContracts';
import { validateManualIdeaInput, type ManualIdeaInput } from '../ideas/manualIdeaDraft';

export interface RealWorkspace { id: string; ownerId: string; name: string }
export interface PersistedIdea {
  databaseId: string;
  workspaceId: string;
  ownerId: string;
  auditId: string;
  provenance: 'MANUAL_LUIS';
  idea: IdeaRecord;
}
export interface CreateRealIdea {
  workspaceId: string;
  externalId: string;
  operationId: string;
  input: ManualIdeaInput;
}
export interface RealIdeaRepository {
  findWorkspace(): Promise<RealWorkspace | null>;
  createWorkspace(): Promise<RealWorkspace>;
  listIdeas(workspaceId: string): Promise<PersistedIdea[]>;
  createIdea(command: CreateRealIdea): Promise<PersistedIdea>;
}
export interface RealIdeaState {
  phase: 'loading' | 'needsWorkspace' | 'ready' | 'saving' | 'error';
  workspace: RealWorkspace | null;
  ideas: PersistedIdea[];
  error: string | null;
  savedId: string | null;
  refreshWarning?: string;
}

/** One store per verified Auth user. DEMO reducers and seeds never enter this boundary. */
export class RealIdeaStore {
  private state: RealIdeaState = { phase: 'loading', workspace: null, ideas: [], error: null, savedId: null };
  private listeners = new Set<() => void>();
  private generation = 0;
  private pending: CreateRealIdea | null = null;
  private inFlight = false;
  private disposed = false;
  constructor(private repository: RealIdeaRepository, private userId: string, private uuid = () => crypto.randomUUID()) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(next: RealIdeaState) { this.state = next; this.listeners.forEach(listener => listener()); }
  /** Terminal session invalidation. Visual unmounts must never call this. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true; ++this.generation; this.pending = null; this.inFlight = false;
    this.set({ phase: 'loading', workspace: null, ideas: [], error: null, savedId: null });
  }
  hasPendingWrite = () => !this.disposed && this.pending !== null;
  retryPending = () => this.pending ? this.save(this.pending.input) : Promise.resolve(false);
  /** Attach a view without invalidating an active write or a confirmed result. */
  async resume() {
    if (this.disposed || this.inFlight || (this.state.phase === 'ready' && !this.pending)) return;
    await this.load();
  }
  private checkWorkspace(workspace: RealWorkspace) {
    if (workspace.ownerId !== this.userId || workspace.name !== 'raxi-hq') throw new Error('El workspace no pertenece a la sesión autenticada.');
  }
  async load() {
    if (this.disposed || this.inFlight) return;
    const generation = ++this.generation;
    this.set({ ...this.state, phase: 'loading', error: null, savedId: null, refreshWarning: undefined });
    try {
      const workspace = await this.repository.findWorkspace();
      if (generation !== this.generation) return;
      if (!workspace) { this.set({ ...this.state, phase: 'needsWorkspace', workspace: null, ideas: [] }); return; }
      this.checkWorkspace(workspace);
      const ideas = await this.repository.listIdeas(workspace.id);
      if (generation !== this.generation) return;
      const confirmedId = this.reconcilePending(ideas, workspace);
      for (const item of ideas) this.checkIdea(item, workspace);
      // Clear only after the entire canonical read passes validation in this generation.
      if (confirmedId) this.pending = null;
      this.set({ phase: 'ready', workspace, ideas: [...ideas], error: null, savedId: confirmedId });
    } catch (cause) { if (generation === this.generation) this.fail(cause); }
  }
  async createWorkspace() {
    if (this.disposed || this.inFlight || this.state.phase !== 'needsWorkspace') return;
    this.inFlight = true;
    const generation = this.generation;
    this.set({ ...this.state, phase: 'saving', error: null });
    try {
      const workspace = await this.repository.createWorkspace();
      if (generation !== this.generation) return;
      this.checkWorkspace(workspace);
      const ideas = await this.repository.listIdeas(workspace.id);
      if (generation !== this.generation) return;
      for (const item of ideas) this.checkIdea(item, workspace);
      this.set({ phase: 'ready', workspace, ideas: [...ideas], error: null, savedId: null });
    } catch (cause) { if (generation === this.generation) this.fail(cause); }
    finally { if (generation === this.generation) this.inFlight = false; }
  }
  private checkIdea(item: PersistedIdea, workspace: RealWorkspace) {
    if (item.ownerId !== this.userId || item.workspaceId !== workspace.id || !item.auditId || !item.databaseId ||
      item.provenance !== 'MANUAL_LUIS' || !item.idea.id.startsWith('IDEA-REAL-')) throw new Error('Respuesta de persistencia inválida.');
  }
  private checkConfirmation(item: PersistedIdea, workspace: RealWorkspace, command: CreateRealIdea) {
    const conflict = () => new Error(`Conflicto de confirmación para ${command.externalId}: el registro no coincide en identidad, contenido o trazabilidad. Se conserva la operación pendiente.`);
    try { this.checkIdea(item, workspace); } catch { throw conflict(); }
    const { idea } = item;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const reference = command.input.sourceRef;
    const evidenceMatches = reference === undefined ? idea.evidence.length === 0 :
      idea.evidence.length === 1 && idea.evidence[0].id === `${command.externalId}-REF` &&
      idea.evidence[0].kind === 'MANUAL_NOTE' && idea.evidence[0].sourceRef === reference &&
      idea.evidence[0].capturedAt === idea.createdAt;
    // Reads come from the owner-scoped RPC, which joins the actual creation audit.
    // An external ID alone, or an untraced/mutated payload, cannot acknowledge a write.
    if (command.workspaceId !== workspace.id || idea.id !== command.externalId ||
      idea.title !== command.input.title || idea.summary !== command.input.note || idea.priority !== command.input.priority ||
      idea.source !== 'MANUAL_LUIS' || idea.status !== 'PROPOSED' || !evidenceMatches ||
      !uuid.test(item.databaseId) || !/^[1-9]\d*$/.test(item.auditId) ||
      !Number.isFinite(Date.parse(idea.createdAt)) || !Number.isFinite(Date.parse(idea.updatedAt)) ||
      Date.parse(idea.updatedAt) < Date.parse(idea.createdAt)) throw conflict();
  }
  private reconcilePending(ideas: PersistedIdea[], workspace: RealWorkspace): string | null {
    if (!this.pending) return null;
    if (this.pending.workspaceId !== workspace.id) throw new Error('Conflicto: el workspace cambió. Se conserva la operación pendiente.');
    const matches = ideas.filter(item => item.idea.id === this.pending!.externalId);
    if (matches.length === 0) return null;
    if (matches.length !== 1) throw new Error(`Conflicto: múltiples registros para ${this.pending.externalId}. Se conserva la operación pendiente.`);
    this.checkConfirmation(matches[0], workspace, this.pending);
    return matches[0].idea.id;
  }
  private fail(cause: unknown) {
    this.set({ ...this.state, phase: 'error', savedId: null, error: cause instanceof Error ? cause.message : 'La operación no se confirmó. Reintenta la conexión.' });
  }
  async save(input: ManualIdeaInput): Promise<boolean> {
    if (this.disposed || this.inFlight || !this.state.workspace || !['ready', 'error'].includes(this.state.phase)) return false;
    const workspace = this.state.workspace;
    let command: CreateRealIdea;
    try {
      const validated = validateManualIdeaInput(input);
      if (this.pending && JSON.stringify(validated) !== JSON.stringify(this.pending.input)) {
        throw new Error('Hay un guardado pendiente de confirmar. Reintenta con el contenido original antes de crear otra idea.');
      }
      command = this.pending ?? { workspaceId: workspace.id, externalId: `IDEA-REAL-${this.uuid()}`, operationId: this.uuid(), input: validated };
    } catch (cause) { this.fail(cause); return false; }
    this.pending = command;
    this.inFlight = true;
    const generation = this.generation;
    this.set({ ...this.state, phase: 'saving', savedId: null, error: null, refreshWarning: undefined });
    try {
      const saved = await this.repository.createIdea(command);
      if (generation !== this.generation) return false;
      this.checkConfirmation(saved, workspace, command);
      let ideas = [...this.state.ideas.filter(item => item.databaseId !== saved.databaseId), saved];
      let refreshWarning: string | undefined;
      try {
        const refreshed = await this.repository.listIdeas(workspace.id);
        if (generation !== this.generation) return false;
        for (const item of refreshed) this.checkIdea(item, workspace);
        if (!refreshed.some(item => item.databaseId === saved.databaseId)) throw new Error('Saved row missing from refresh');
        ideas = [...refreshed];
      } catch {
        if (generation !== this.generation) return false;
        refreshWarning = 'La idea se guardó, pero no pudimos actualizar la lista completa. Reintenta la lectura.';
      }
      this.pending = null;
      this.set({ ...this.state, phase: 'ready', ideas, refreshWarning, error: null, savedId: saved.idea.id });
      return true;
    } catch (cause) { if (generation === this.generation) this.fail(cause); return false; }
    finally { if (generation === this.generation) this.inFlight = false; }
  }
}
