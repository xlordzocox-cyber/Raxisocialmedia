import type { IdeaRecord } from '../src/ideas/ideaContracts';
import { createIdeaHandoff } from '../src/ideas/ideaValidation';
import { applyCampaignOperation, emptyCampaignSnapshot, type CampaignSnapshot, type RealCampaignAction } from '../src/persistence/campaignCommands';
export const attentionOwner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',attentionWorkspace='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const attentionAt='2026-10-31T12:00:00Z';
export function attentionFixture():CampaignSnapshot{
  const idea:IdeaRecord={id:'IDEA-REAL-cccccccc-cccc-4ccc-8ccc-cccccccccccc',title:'Propuesta sintética para Luis',summary:'Fixture local sin ejecución',reason:'Revisión manual',source:'MANUAL_LUIS',status:'SENT_TO_HQ',priority:'MEDIUM',createdAt:attentionAt,updatedAt:attentionAt,approvedAt:attentionAt,sentToHqAt:attentionAt,suggestedChannels:['INSTAGRAM_FEED'],tags:[],evidence:[],fitScore:0,confidenceScore:0};
  const second={...idea,id:'IDEA-REAL-dddddddd-dddd-4ddd-8ddd-dddddddddddd',title:'Propuesta para Strategy sintética'};
  let snapshot={...emptyCampaignSnapshot(attentionOwner,attentionWorkspace,[idea,second]),serverTime:attentionAt,handoffs:[idea,second].map(i=>({handoff:createIdeaHandoff(i),provenance:'REAL' as const}))};
  let number=0;
  const run=(action:RealCampaignAction)=>{snapshot=applyCampaignOperation(snapshot,{workspaceId:attentionWorkspace,operationId:`eeeeeeee-eeee-4eee-8eee-${String(++number).padStart(12,'0')}`,expectedVersion:snapshot.version,action});};
  run({type:'CREATE_CAMPAIGN',ideaId:second.id,brief:{title:'Campaña sintética en revisión',objective:'Comunidad',priority:'MEDIUM',channels:['INSTAGRAM_FEED'],contentLevels:['PUBLIC_SOCIAL'],keyMessage:'Conversación'}});
  const campaignId=snapshot.session.campaigns[0].id;
  run({type:'TRANSITION_CAMPAIGN',campaignId,to:'PLANNING'});
  run({type:'SAVE_STRATEGY',campaignId,input:{audience:'Audiencia adulta',audienceNeed:'Conversación',creativeConcept:'Tarde de gaming',narrativeApproach:'Inicio y cierre',visualDirection:'Luz natural',toneOfVoice:'Conversacional',desiredAudienceResponse:'Comentar',successCriteria:'Evaluación cualitativa',deliverables:[{id:'STRATEGY-ITEM-001',channel:'INSTAGRAM_FEED',contentLevel:'PUBLIC_SOCIAL',format:'PHOTO',quantity:1,purpose:'Comunidad',creativeAngle:'Una partida inesperada'}]}});
  run({type:'SUBMIT_STRATEGY',campaignId,revision:1});return snapshot;
}
