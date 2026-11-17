// Agencia: pure read model for the home page, derived only from the validated Fototeca and Multimedia views.
import { canApprove, progress, type PortfolioView } from '../portfolio/portfolioModel';
import { characterLabel, type MediaView } from '../portfolio/mediaModel';

export interface AgencyPending { itemId: string; kind: 'DECIDE' | 'FIX'; collectionId: string; collectionTitle: string; position: number; assetPath: string | null }
export interface AgencyProduction { id: string; title: string; channel: string; character: string; total: number; approved: number; published: number; blocked: number }
export interface AgencyTalent { id: string; name: string; photos: number; campaigns: number; coverPath: string | null }
export interface AgencyView { pending: AgencyPending[]; productions: AgencyProduction[]; talent: AgencyTalent[] }

const FINISHED = new Set(['PUBLISHED', 'ARCHIVED']);
/** The agency's talent. A model stays listed even before she has photos or campaigns. */
export const TALENT_ROSTER = ['raxi-vox', 'vesper-corvus'] as const;

export function buildAgency(portfolio: PortfolioView, media: MediaView): AgencyView {
  const open = portfolio.collections.filter((c) => !FINISHED.has(c.status));
  const pending: AgencyPending[] = open.flatMap((c) => c.items.flatMap((i): AgencyPending[] => {
    if (i.decision !== 'PENDING' || i.status === 'PUBLISHED') return [];
    const blocked = i.qaStatus === 'NEEDS_FIX' || i.qaStatus === 'FAIL';
    if (!blocked && !canApprove(i)) return [];
    return [{ itemId: i.id, kind: blocked ? 'FIX' : 'DECIDE', collectionId: c.id, collectionTitle: c.title, position: i.position, assetPath: i.asset?.objectPath ?? null }];
  }));
  const productions = open.map((c) => ({ id: c.id, title: c.title, channel: c.channel, character: characterLabel(c.characterId), ...progress(c.items) }));
  const ids = [...new Set([...TALENT_ROSTER, ...portfolio.collections.map((c) => c.characterId), ...media.characters])].sort();
  const talent = ids.map((id): AgencyTalent => {
    const photos = media.assets.filter((a) => a.characterId === id);
    return {
      id, name: characterLabel(id), photos: photos.length,
      campaigns: portfolio.collections.filter((c) => c.characterId === id).length,
      coverPath: photos.find((a) => a.level === 'PUBLIC')?.objectPath ?? null, // media.assets is newest first
    };
  });
  return { pending, productions, talent };
}
