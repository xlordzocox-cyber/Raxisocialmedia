export interface MemorySignal {
  id: string;
  label: string;
  status: 'REQUESTED' | 'ARCHIVED' | 'FAILED';
  sourceEventId: string;
}
