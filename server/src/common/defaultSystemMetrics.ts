import { Metric } from './types/Metric.js';
import { SpanStats } from './types/Span.js';



export const COST_METRIC_ID = 'cost';
export const TOTAL_TOKENS_METRIC_ID = 'totalTokens';
export const DURATION_METRIC_ID = 'duration';
export const ERRORS_METRIC_ID = 'errors';
export const SPECIFIC_METRIC_ID = 'specific';
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
    /** matches SpanStats.duration */
    id: DURATION_METRIC_ID,
    name: 'Duration',
    description: 'Total duration of the trace',
    unit: 'ms',
    type: 'system',
  },
  {
    /** matches SpanStats.totalTokens */
    id: TOTAL_TOKENS_METRIC_ID,
    name: 'Token Count',
    description: 'Total number of tokens used',
    unit: 'tokens',
    type: 'system',
  },
  {
    /** matches SpanStats.cost */
    id: COST_METRIC_ID,
    name: 'Token Cost',
    description: 'Total cost of tokens used',
    unit: 'USD',
    type: 'system',
  },
];

export const SPECIFIC_METRIC: Metric = {
  id: SPECIFIC_METRIC_ID,
  name: 'Example Specific',
  description: 'Output rules for this example',
  unit: 'string',
  type: 'llm',
};

