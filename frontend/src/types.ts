// Kształty odpowiadające schematom Pydantic backendu (warstwa 2).

export interface ScoreFactor {
  name: string;
  points: number;
  max_points: number;
  applicable: boolean;
  rationale: string;
}

export interface SLTP {
  entry: number;
  stop_loss: number;
  take_profit: number | null;
  risk: number;
  reward: number | null;
  rr: number | null;
  rr_ok: boolean;
  warnings: string[];
}

export interface FundamentalContext {
  base_ccy: string;
  quote_ccy: string;
  base_rate: number | null;
  quote_rate: number | null;
  rate_differential: number | null;
  carry_bias: string;
  fundamental_bias: string;
  alignment: string;
  high_impact_event_warning: string | null;
  notes: string[];
  source: string;
  as_of: string;
}

export interface AnalysisResult {
  id: number | null;
  created_at: string | null;
  pair: string;
  timeframe: string;
  trend: string;
  pattern: string;
  pattern_direction: string;
  factors: ScoreFactor[];
  raw_points: number;
  max_points: number;
  score: number;
  verdict: string;
  threshold: number;
  sltp: SLTP;
  fundamentals: FundamentalContext;
  reasoning: string;
  warnings: string[];
  vision_confidence: number;
  disclaimer: string;
}

export interface AppConfig {
  default_pairs: string[];
  timeframes: string[];
  mock_mode: boolean;
  entry_threshold: number;
}

export interface HistoryItem {
  id: number;
  created_at: string;
  pair: string;
  timeframe: string;
  score: number;
  verdict: string;
}
