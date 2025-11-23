export interface ApiKey {
  id: string;
  organisation_id: string;
  key_hash: string;
  rate_limit_per_hour?: number;
  retention_period_days?: number;
  created: Date;
  updated: Date;
}

