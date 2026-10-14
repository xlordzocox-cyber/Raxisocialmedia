import type { AgentStatus } from '../../domain/agents';

export interface StatusVisual {
  label: string;
  color: number;
  icon: string;
  animation: 'idle' | 'walk' | 'work' | 'research' | 'review' | 'waiting' | 'blocked' | 'complete';
}

export function getStatusVisual(status: AgentStatus): StatusVisual {
  switch (status) {
    case 'WALKING':
      return { label: 'Walking', color: 0x35e7ff, icon: '>', animation: 'walk' };
    case 'RUNNING':
    case 'WORKING':
      return { label: 'Running', color: 0xb68cff, icon: '*', animation: 'work' };
    case 'QA':
      return { label: 'Reviewing', color: 0x5be39a, icon: 'QA', animation: 'review' };
    case 'RESEARCHING':
      return { label: 'Research', color: 0x35e7ff, icon: '?', animation: 'research' };
    case 'WAITING':
    case 'WAITING_AGENT':
    case 'WAITING_ASSET':
    case 'WAITING_QA':
    case 'WAITING_APPROVAL':
      return { label: 'Waiting', color: 0xffc857, icon: '...', animation: 'waiting' };
    case 'BLOCKED':
    case 'FAILED':
    case 'QUARANTINED':
      return { label: 'Blocked', color: 0xff5f7a, icon: '!', animation: 'blocked' };
    case 'COMPLETED':
      return { label: 'Complete', color: 0x5be39a, icon: 'ok', animation: 'complete' };
    case 'READY':
    case 'QUEUED':
    case 'IDLE':
    default:
      return { label: status.toLowerCase(), color: 0x99a3b8, icon: '•', animation: 'idle' };
  }
}
