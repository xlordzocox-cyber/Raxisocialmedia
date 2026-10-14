export interface TaskSnapshot {
  id: string;
  title: string;
  status: string;
  ownerAgentId?: string;
  campaignId?: string;
  dependsOn?: string[];
  approvalRequired?: boolean;
}
