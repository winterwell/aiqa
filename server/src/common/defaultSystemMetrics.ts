import { Metric } from './types/Dataset';
import { GEN_AI_USAGE_TOTAL_TOKENS, GEN_AI_COST_USD } from './constants_otel.js';

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
    /** matches the OpenTelemetry semantic convention */
    id: GEN_AI_USAGE_TOTAL_TOKENS,
    name: 'Token Count',
    description: 'Total number of tokens used',
    unit: 'tokens',
    type: 'system',
  },
  {
    /** matches the semi-standard-like otel attribute we use */
    id: GEN_AI_COST_USD,
    name: 'Token Cost',
    description: 'Total cost of tokens used',
    unit: 'USD',
    type: 'system',
  },
];

