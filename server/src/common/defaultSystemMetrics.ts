import { Metric } from './types/Dataset';

/**
 * Default system metrics that are always available for datasets.
 * These are built-in metrics that AIQA handles automatically.
 */
export const DEFAULT_SYSTEM_METRICS: Metric[] = [
//   {
//     name: 'usage_count',
//     description: 'Number of times this example was used',
//     unit: 'count',
//     type: 'system',
//   },
  {
    id: 'duration',
    name: 'Duration',
    description: 'Total duration of the trace',
    unit: 'ms',
    type: 'system',
  },
  {
    id: 'token_count',
    name: 'Token Count',
    description: 'Total number of tokens used',
    unit: 'tokens',
    type: 'system',
  },
  {
    id: 'token_cost',
    name: 'Token Cost',
    description: 'Total cost of tokens used',
    unit: 'USD',
    type: 'system',
  },
];

