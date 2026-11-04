import { LifecycleStatus } from "./LifecycleStatus";

type Subscription = {
  type: "trial" | "free" | "pro" | "enterprise";
  status: LifecycleStatus;
  start: Date;
  end: Date | null;
  renewal: Date | null;
  pricePerMonth: number;
  currency: "USD" | "EUR" | "GBP";
}

export default interface OrganisationAccount {
  id: string;
  organisation: string; // Organisation ID (foreign key)

  subscription: Subscription;
  /** Stripe customer ID */
  stripeCustomerId?: string;
  /** Stripe subscription ID */
  stripeSubscriptionId?: string;
  /** default: 1000 */
  rateLimitPerHour?: number;
  /** default: 20 */
  retentionPeriodDays?: number;
  maxMembers?: number;
  maxDatasets?: number;
  experimentRetentionDays?: number;
  maxExamplesPerDataset?: number;

  created: Date;
  updated: Date;

  /** default: 1.0 meaning keep-all. This relies on clients to call and get updated sampling frequency. Sampling should be applied to include/exclude whole traces e.g. using a hash of the trace ID. */
  samplingFrequencyClient?: number;
  /** // default: 1.0 meaning keep-all. This is applied by the server to all incoming traces. It is independent of the client's sampling frequency. */
  samplingFrequencyServer?: number; 
  spanFilterClient?: string[];
  spanFilterServer?: string[];
  /** chain, starting with include-all or exclude-all, followed by a chain of alternating exclude/include exceptoins, e.g. ["exclude-all","attributes.gen_ai.tool.name:websearch AND attributes.gen_ai.tool.call.arguments:fish"] */
  traceFilterClient?: string[];
  traceFilterServer?: string[];

}

