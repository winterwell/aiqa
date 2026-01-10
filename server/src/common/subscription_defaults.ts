/**
 * Subscription defaults utility.
 * Loads subscription thresholds from subscriptions.json and provides fallback values.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

type SubscriptionDefaults = {
  rate_limit_per_hour: number;
  retention_period_days: number;
  max_members: number;
  max_datasets: number;
  experiment_retention_days: number;
  max_examples_per_dataset: number;
};

type SubscriptionsConfig = {
  free: SubscriptionDefaults;
  trial: SubscriptionDefaults;
  enterprise: SubscriptionDefaults;
};

{
	"free": {
		"rate_limit_per_hour": 100,
		"retention_period_days": 7,
		"max_members": 1,
		"max_datasets": 1,
		"experiment_retention_days": 30,
		"max_examples_per_dataset": 100
	},
	"trial": {
		"rate_limit_per_hour": 1000,
		"retention_period_days": 30,
		"max_members": 10,
		"max_datasets": 10,
		"experiment_retention_days": 45,
		"max_examples_per_dataset": 1000
	},
	"pro": {
		"rate_limit_per_hour": 1000,
		"retention_period_days": 30,
		"max_members": 10,
		"max_datasets": 10,
		"experiment_retention_days": 45,
		"max_examples_per_dataset": 1000
	},
	"enterprise": {
		"rate_limit_per_hour": 10000,
		"retention_period_days": 365,
		"max_members": 100,
		"max_datasets": 100,
		"experiment_retention_days": 365,
		"max_examples_per_dataset": 10000
	}
}


let subscriptionsConfig: SubscriptionsConfig | null = null;

function loadSubscriptionsConfig(): SubscriptionsConfig {
  if (subscriptionsConfig) {
    return subscriptionsConfig;
  }

  try {
    // Path from dist/common/subscription_defaults.js to server root subscriptions.json
    // __dirname is dist/common/, so we go up 2 levels to reach server root
    const configPath = join(__dirname, '../../subscriptions.json');
    const fileContent = readFileSync(configPath, 'utf-8');
    subscriptionsConfig = JSON.parse(fileContent) as SubscriptionsConfig;
    return subscriptionsConfig;
  } catch (error) {
    console.error('Error loading subscriptions.json:', error);
    // Return safe defaults if file can't be loaded
    return {
      free: {
        rate_limit_per_hour: 100,
        retention_period_days: 7,
        max_members: 1,
        max_datasets: 1,
        experiment_retention_days: 30,
        max_examples_per_dataset: 100,
      },
      trial: {
        rate_limit_per_hour: 1000,
        retention_period_days: 30,
        max_members: 10,
        max_datasets: 10,
        experiment_retention_days: 45,
        max_examples_per_dataset: 1000,
      },
      enterprise: {
        rate_limit_per_hour: 10000,
        retention_period_days: 365,
        max_members: 1000,
        max_datasets: 1000,
        experiment_retention_days: 365,
        max_examples_per_dataset: 10000,
      },
    };
  }
}

/**
 * Get subscription defaults for a given subscription type.
 * Returns null if subscription type is invalid.
 */
export function getSubscriptionDefaults(
  subscriptionType: 'free' | 'trial' | 'enterprise' | string | undefined
): SubscriptionDefaults | null {
  if (!subscriptionType) {
    return null;
  }

  const config = loadSubscriptionsConfig();
  const type = subscriptionType.toLowerCase();
  
  if (type === 'free' || type === 'trial' || type === 'enterprise') {
    return config[type];
  }

  return null;
}

/**
 * Get a specific threshold value for an organisation, falling back to subscription defaults.
 * 
 * @param org - Organisation object
 * @param thresholdKey - Key of the threshold to get (e.g., 'rate_limit_per_hour')
 * @returns The threshold value, or null if not set and no subscription fallback
 */
export function getOrganisationThreshold<T extends keyof SubscriptionDefaults>(
  org: { subscription?: { type?: string } } & Partial<Record<T, number>>,
  thresholdKey: T
): number | null {
  // First check if organisation has explicit value
  const explicitValue = org[thresholdKey];
  if (explicitValue !== undefined && explicitValue !== null) {
    return explicitValue;
  }

  // Fall back to subscription defaults
  const subscriptionType = org.subscription?.type;
  if (subscriptionType) {
    const defaults = getSubscriptionDefaults(subscriptionType);
    if (defaults && thresholdKey in defaults) {
      return defaults[thresholdKey];
    }
  }

  return null;
}

