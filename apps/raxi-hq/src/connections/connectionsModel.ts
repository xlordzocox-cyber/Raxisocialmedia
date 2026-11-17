// Conexiones: pure, validated model. The provider secret never enters this module's output.

export const PROVIDERS = ['WAVESPEED'] as const;
export type Provider = (typeof PROVIDERS)[number];
export type ConnectionStatus = 'NOT_CONNECTED' | 'CONNECTED' | 'INVALID';
export const PROVIDER_LABEL: Record<Provider, string> = { WAVESPEED: 'WaveSpeed' };

export interface ConnectionView { provider: Provider; label: string; last4: string | null; status: ConnectionStatus; verifiedAt: string | null }

const STATUSES = new Set<ConnectionStatus>(['CONNECTED', 'INVALID']);

/** Client-side shape check only; the server verifies the key against the provider. */
export function validateProviderKey(raw: unknown): string {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (key.length < 16 || key.length > 512 || /\s/.test(key) || !/^[\x21-\x7e]+$/.test(key)) throw new Error('La clave no tiene un formato válido.');
  return key;
}

export function buildConnections(workspaceId: string, rawRows: unknown): ConnectionView[] {
  if (!Array.isArray(rawRows)) throw new Error('Conexiones: respuesta inválida');
  const found = new Map<Provider, ConnectionView>();
  for (const r of rawRows as Record<string, unknown>[]) {
    if (r.workspace_id !== workspaceId) throw new Error('Conexiones: fila ajena');
    if (!PROVIDERS.includes(r.provider as Provider)) throw new Error('Conexiones: proveedor inválido');
    if (typeof r.last4 !== 'string' || !/^[\x21-\x7e]{4}$/.test(r.last4)) throw new Error('Conexiones: dato inválido');
    if (!STATUSES.has(r.status as ConnectionStatus)) throw new Error('Conexiones: estado inválido');
    const provider = r.provider as Provider;
    found.set(provider, { provider, label: PROVIDER_LABEL[provider], last4: r.last4, status: r.status as ConnectionStatus, verifiedAt: typeof r.verified_at === 'string' ? r.verified_at : null });
  }
  return PROVIDERS.map((p) => found.get(p) ?? { provider: p, label: PROVIDER_LABEL[p], last4: null, status: 'NOT_CONNECTED', verifiedAt: null });
}
