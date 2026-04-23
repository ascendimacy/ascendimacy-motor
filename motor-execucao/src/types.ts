export interface PlaybookEntry {
  id: string;
  title: string;
  category: string;
  triggers: string[];
  content: string;
  estimatedSacrifice: number;
  estimatedConfidenceGain: number;
}

export interface PlaybookInventory {
  version: string;
  playbooks: PlaybookEntry[];
}
