export interface Bale {
  id: string; // The search ID (Barcode)
  originalId: string;
  mappedValues: Record<string, string | number>; // Dynamic mapped columns (Mic, Strength, etc)
  millLot: string;
  millBaleNumber: number;
  weight: number | null;
  scannedAt?: string;
  aiAnalysis?: string;
  status: 'pending' | 'completed';
}

export interface Session {
  id: string;
  name: string;
  createdAt: string;
  type: 'manual' | 'excel';
  config: SessionConfig;
  bales: Bale[];
  status: 'active' | 'archived';
}

export interface SessionConfig {
  startMillLot: string;
  startMillBale: number;
  currentMillBale: number; // Auto-increment tracker
  columnMapping?: {
    searchColumn: string;
    value1: string; // e.g. Mic
    value2: string; // e.g. Strength
    value1Name: string;
    value2Name: string;
  };
}

export interface ExcelRow {
  [key: string]: any;
}

export type ViewState = 
  | 'HOME' 
  | 'SETUP_MANUAL' 
  | 'SETUP_EXCEL' 
  | 'MAPPING' 
  | 'WORKBENCH';
