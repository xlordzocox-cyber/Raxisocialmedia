import type { SupabaseClient } from '@supabase/supabase-js';
import { validateIdeaRecord } from '../ideas/ideaValidation';
import type { PersistedIdea, RealIdeaRepository, RealWorkspace } from './realIdeaStore';

function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Supabase devolvió un registro inválido.');
  return raw as Record<string, unknown>;
}
function required(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('La respuesta de Supabase está incompleta.');
  return raw;
}
export function parseWorkspace(raw: unknown, ownerId: string): RealWorkspace {
  const data = record(raw);
  const workspace = { id: required(data.id), ownerId: required(data.ownerId), name: required(data.name) };
  if (workspace.ownerId !== ownerId || workspace.name !== 'raxi-hq') throw new Error('El workspace no pertenece a tu cuenta.');
  return workspace;
}
export function parsePersistedIdea(raw: unknown, ownerId: string, workspaceId: string): PersistedIdea {
  const data = record(raw);
  const idea = validateIdeaRecord(data.idea);
  if (data.ownerId !== ownerId || data.workspaceId !== workspaceId || data.provenance !== 'MANUAL_LUIS' || idea.source !== 'MANUAL_LUIS' || !idea.id.startsWith('IDEA-REAL-')) {
    throw new Error('La respuesta no corresponde a una idea manual REAL de tu workspace.');
  }
  return { databaseId: required(data.databaseId), workspaceId, ownerId, auditId: required(data.auditId), provenance: 'MANUAL_LUIS', idea };
}
function readError(code?: string): Error {
  return new Error(code === 'PGRST202' ? 'El servicio de persistencia v0.9 aún no está desplegado. No se cargan datos DEMO.' : 'No se pudo consultar Supabase. Revisa la conexión y vuelve a intentarlo.');
}
export function createSupabaseIdeaRepository(client: SupabaseClient, ownerId: string): RealIdeaRepository {
  return {
    async findWorkspace() {
      const { data, error } = await client.rpc('raxi_get_workspace');
      if (error) throw readError(error.code);
      return data === null ? null : parseWorkspace(data, ownerId);
    },
    async createWorkspace() {
      const { data, error } = await client.rpc('raxi_create_workspace');
      if (error) throw new Error('No se confirmó la creación del workspace. Reintenta la conexión para comprobar si ya existe.');
      return parseWorkspace(data, ownerId);
    },
    async listIdeas(workspaceId) {
      const { data, error } = await client.rpc('raxi_list_manual_ideas', { p_workspace: workspaceId });
      if (error) throw readError(error.code);
      if (!Array.isArray(data)) throw new Error('Supabase no devolvió una lista de ideas.');
      const ideas = data.map(value => parsePersistedIdea(value, ownerId, workspaceId));
      if (new Set(ideas.map(item => item.databaseId)).size !== ideas.length || new Set(ideas.map(item => item.idea.id)).size !== ideas.length) throw new Error('La consulta contiene IDs duplicados.');
      return ideas;
    },
    async createIdea(command) {
      const { data, error } = await client.functions.invoke('create-real-idea', { body: command });
      if (error) {
        const status = error.context?.status;
        throw new Error(status === 401 ? 'La sesión expiró. Vuelve a iniciar sesión antes de guardar.' : status === 403 ? 'No tienes acceso a ese workspace.' : status === 409 ? 'Conflicto de idempotencia: comprueba el registro persistido antes de cambiar la operación.' : 'El servidor no confirmó el guardado. Reintenta el mismo contenido.');
      }
      return parsePersistedIdea(data, ownerId, command.workspaceId);
    },
  };
}
