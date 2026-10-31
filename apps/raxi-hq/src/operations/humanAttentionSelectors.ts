import type { RealCampaignState } from '../persistence/realCampaignStore';
import { currentStrategy } from '../campaigns/campaignSession';

/** Presentation context only: AuthStore and the canonical stores own admission. */
export interface HumanAttentionContext {
  ownerId?: string; workspaceId?: string; mode: 'REAL' | 'DEMO';
  synchronized: boolean; ideasReady: boolean; ideaPending: boolean;
}
export interface HumanAttentionItem {
  kind: 'proposal' | 'strategy'; id: string; title: string; origin: string; date: string;
  campaignId?: string; revision?: number;
}
export function humanAttention(state: RealCampaignState, context: HumanAttentionContext) {
  const snapshot=state.snapshot;
  const available=context.mode==='REAL' && context.ideasReady && !context.ideaPending && context.synchronized &&
    state.phase==='ready' && !state.pending && !state.error && !!context.ownerId && !!context.workspaceId &&
    snapshot?.ownerId===context.ownerId && snapshot?.workspaceId===context.workspaceId;
  const items:HumanAttentionItem[]=[], warnings:string[]=[];
  if(!available || !snapshot)return {available:false,items,warnings};
  const {handoffs,ideas,session}=snapshot;
  const duplicate=<T,>(values:readonly T[],key:(value:T)=>string)=>{
    const seen=new Set<string>(),bad=new Set<string>();
    for(const value of values){const id=key(value);if(seen.has(id))bad.add(id);seen.add(id);}return bad;
  };
  const badIdeas=duplicate(ideas,i=>i.id),badHandoffs=duplicate(handoffs,i=>i.handoff.ideaId);
  const badCampaigns=duplicate(session.campaigns,c=>c.id),badSources=duplicate(session.campaigns,c=>c.sourceIdeaId);
  const badDecisions=duplicate(session.decisions,d=>d.ideaId);
  const badDecisionLinks=duplicate(session.decisions.filter(d=>d.status==='ACCEPTED' && !!d.campaignId),d=>d.campaignId!);
  const validProposals=new Set<string>();
  for(const {handoff:h,provenance} of handoffs){
    const idea=ideas.find(i=>i.id===h.ideaId),decisions=session.decisions.filter(d=>d.ideaId===h.ideaId);
    if(provenance!=='REAL' || badIdeas.has(h.ideaId) || badHandoffs.has(h.ideaId) || badDecisions.has(h.ideaId) || badSources.has(h.ideaId) ||
      !idea || idea.status!=='SENT_TO_HQ' || idea.source!=='MANUAL_LUIS' || h.source!==idea.source || !h.ideaId.startsWith('IDEA-REAL-') || h.sentAt!==idea.sentToHqAt){
      warnings.push(`Propuesta ${h.ideaId}: procedencia o referencias ambiguas.`);continue;
    }
    validProposals.add(h.ideaId);
    const decision=decisions[0],campaigns=session.campaigns.filter(c=>c.sourceIdeaId===h.ideaId);
    if(decision?.status==='ACCEPTED' || decision?.status==='REJECTED'){
      if(decision.status==='ACCEPTED' && (campaigns.length!==1 || campaigns[0].id!==decision.campaignId) || decision.status==='REJECTED' && campaigns.length)warnings.push(`Propuesta ${h.ideaId}: decisión y campaña contradictorias.`);
      continue;
    }
    if(campaigns.length || decision?.campaignId){warnings.push(`Propuesta ${h.ideaId}: campaña incompatible con la ausencia de decisión.`);continue;}
    items.push({kind:'proposal',id:h.ideaId,title:h.title,origin:h.ideaId,date:h.sentAt});
  }
  for(const c of session.campaigns){
    const revisions=session.strategies.filter(s=>s.campaignId===c.id);
    const decision=session.decisions.filter(d=>d.ideaId===c.sourceIdeaId);
    const handoff=handoffs.find(h=>h.handoff.ideaId===c.sourceIdeaId)?.handoff;
    if(badCampaigns.has(c.id) || badSources.has(c.sourceIdeaId) || c.provenance!=='REAL' || !validProposals.has(c.sourceIdeaId) ||
      decision.length!==1 || decision[0].status!=='ACCEPTED' || decision[0].campaignId!==c.id || badDecisionLinks.has(c.id) || c.sourceHandoffSentAt!==handoff?.sentAt ||
      revisions.some((s,index)=>s.revision!==index+1)){
      warnings.push(`Campaña ${c.id}: relación o revisiones inconsistentes.`);continue;
    }
    const revision=currentStrategy(session,c.id);
    if(c.status!=='PLANNING' || revision?.status!=='IN_REVIEW')continue;
    items.push({kind:'strategy',id:c.id,title:c.title,origin:c.sourceIdeaId,date:revision.updatedAt,campaignId:c.id,revision:revision.revision});
  }
  for(const revision of session.strategies)if(!session.campaigns.some(c=>c.id===revision.campaignId))warnings.push(`Strategy ${revision.campaignId}: campaña ausente.`);
  for(const decision of session.decisions)if(!handoffs.some(h=>h.handoff.ideaId===decision.ideaId))warnings.push(`Decisión ${decision.ideaId}: propuesta ausente.`);
  return {available:true,items,warnings:[...new Set(warnings)]};
}
export type HumanAttentionView=ReturnType<typeof humanAttention>;
