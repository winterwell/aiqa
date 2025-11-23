export interface Organisation {
  id: string;
  name: string;
  rate_limit_per_hour?: number;
  retention_period_days?: number;
  /** User ids of members of the organisation. Must contain the current user's id. */
  members: string[];
  created: Date;
  updated: Date;
}

