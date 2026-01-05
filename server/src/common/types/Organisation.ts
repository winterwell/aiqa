import { LifecycleStatus } from "./LifecycleStatus";

type Subscription = {
  type: "trial" | "free" | "pro" | "enterprise";
  status: LifecycleStatus;
  start_date: Date;
  end_date: Date | null;
  renewal_date: Date | null;
  price_per_month: number;
  currency: "USD" | "EUR" | "GBP";
}

type MemberSettings = {
  role: "admin" | "standard";
}

export default interface Organisation {
  id: string;
  name: string;
  
  subscription: Subscription;
  /** default: 1000 */
  rate_limit_per_hour?: number;
  /** default: 20 */
  retention_period_days?: number;
  max_members?: number;
  max_datasets?: number;
  experiment_retention_days?: number;
  max_examples_per_dataset?: number;
  
  /** User ids of members of the organisation. Must contain the current user's id. */
  members: string[];
  /** user id to user-specific settings for the organisation */
  member_settings: Record<string, MemberSettings>;
  created: Date;
  updated: Date;
}

