export const PRODUCTION_REF = 'jrkefsylpfriiqefcmzq';
export function stagingTarget(env) {
  const ref = env.RAXI_STAGING_REF;
  if (!/^[a-z]{20}$/.test(ref ?? '') || ref === PRODUCTION_REF) throw new Error('Isolated staging project required');
  const api = new URL(env.RAXI_STAGING_URL);
  const db = new URL(env.RAXI_STAGING_DATABASE_URL);
  if (api.href !== `https://${ref}.supabase.co/` || api.username || api.password ||
      db.protocol !== 'postgresql:' || db.hostname !== `db.${ref}.supabase.co` || db.port !== '5432' ||
      db.search || db.hash || !db.password || decodeURIComponent(db.username) !== 'postgres') throw new Error('Staging endpoints do not match the isolated project');
  if (env.RAXI_STAGING_ACK !== 'RUN_ISOLATED_STAGING_ACCEPTANCE') throw new Error('Explicit staging acceptance authorization required');
  return { ref, api: api.origin, database: db.href };
}
