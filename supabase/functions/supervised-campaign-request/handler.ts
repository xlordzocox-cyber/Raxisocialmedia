/**
 * Edge entry boundary only. No privileged client, connection, or secrets here.
 * A signed Supabase JWT and SQL identity checks remain mandatory in the domain.
 */
export interface SupervisedEdgeHandlers {
  preflight(request: Request): Promise<Response>;
  submit(request: Request): Promise<Response>;
}
export function createSupervisedCampaignEdgeHandler(deps: {
  enabled: boolean;
  allowedOrigins: readonly string[];
  handlers: SupervisedEdgeHandlers | null;
}) {
  const allowedOrigins = new Set(deps.allowedOrigins.filter(Boolean));
  const noStore = { 'Cache-Control': 'no-store' };
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    // CORS is browser isolation, not authentication. Fail closed for unknown origins.
    if (origin && !allowedOrigins.has(origin)) {
      return Response.json({ status: 'INELIGIBLE', reason: 'ORIGIN_DENIED' }, { status: 403, headers: noStore });
    }
    const headers: Record<string, string> = {
      ...noStore,
      ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...headers, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-raxi-operation',
          'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '60' },
      });
    }
    if (request.method !== 'POST') {
      return Response.json({ status: 'INELIGIBLE', reason: 'METHOD_NOT_ALLOWED' }, { status: 405, headers });
    }
    // OFF by default even after a deployment. This gate is not an approval to write.
    if (!deps.enabled || !deps.handlers) {
      return Response.json({ status: 'DISABLED', reason: 'STAGING_APPROVAL_REQUIRED' }, { status: 503, headers });
    }
    // Supabase Edge Function is invoked by its single registered function slug;
    // clients select the strictly closed operation via a custom request header.
    const path = new URL(request.url).pathname;
    if (!path.endsWith('/supervised-campaign-request')) {
      return Response.json({ status: 'INELIGIBLE', reason: 'ROUTE_NOT_FOUND' }, { status: 404, headers });
    }
    const operation = request.headers.get('x-raxi-operation');
    if (operation !== 'preflight' && operation !== 'submit') {
      return Response.json({ status: 'INELIGIBLE', reason: 'OPERATION_REQUIRED' }, { status: 400, headers });
    }
    try {
      const handler = operation === 'preflight' ? deps.handlers.preflight : deps.handlers.submit;
      const result = await handler(request);
      const output = new Response(result.body, {
        status: result.status, statusText: result.statusText, headers: result.headers,
      });
      for (const [key, value] of Object.entries(headers)) output.headers.set(key, value);
      return output;
    } catch {
      return Response.json({ status: 'UNKNOWN', reason: 'CONFIRMATION_UNAVAILABLE' }, { status: 503, headers });
    }
  };
}
