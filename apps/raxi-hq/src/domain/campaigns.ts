export interface CampaignSnapshot {
  id: string;
  title: string;
  objective: string;
  progress: number;
  status: 'MOCK_PLANNING' | 'MOCK_QA' | 'MOCK_READY' | 'BLOCKED';
}
