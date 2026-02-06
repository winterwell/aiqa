import { MetricStats } from '../common/types/Experiment.js';

/**
 * TODO
 * Calculates Overall Score as geometric mean of all metric means.
 * Geometric mean: (x1 * x2 * ... * xn)^(1/n)
 * Returns null if no valid metrics found or if any metric mean is <= 0.
 */
function calculateOverallScore(results: Array<{ scores: Record<string, number> }>): MetricStats {
  // Assume: metrics are either:
  // like cost, high is bad, [0, inf)
  // like score, high is good, [0, 1]
  // TODO
  return null;
}

/**
 * Recalculates summary results from all results.
 * This is used when updating existing results to ensure accuracy.
 */
export function recalculateSummaryResults(results: Array<{ scores: Record<string, number> }>): Record<string, MetricStats> {
  const summary: Record<string, MetricStats> = {};

  for (const result of results) {
    if (!result.scores) {
      continue;
    }
    for (const [metricName, value] of Object.entries(result.scores)) {
      // Skip non-numeric values
      if (typeof value !== 'number' || !isFinite(value)) {
        continue;
      }

      const existing = summary[metricName];
      if (!existing) {
        summary[metricName] = {
          mean: value,
          min: value,
          max: value,
          var: 0,
          count: 1,
        };
        continue;
      }
      const oldCount = existing.count;
      const newCount = oldCount + 1;
      const oldMean = existing.mean;
      const delta = value - oldMean;
      const newMean = oldMean + delta / newCount;

      // Calculate variance using Welford's algorithm
      // M2 (sum of squared differences) = variance * (n - 1)
      // When oldCount = 1, existing.var = 0, so M2_old = 0
      // M2_new = M2_old + delta * (value - newMean)
      // variance_new = M2_new / (newCount - 1)
      let newVar: number;
      if (oldCount === 1) {
        // Special case: going from 1 to 2 values
        // M2_old = 0 (variance of 1 value is 0)
        // M2_new = 0 + delta * (value - newMean)
        newVar = (delta * (value - newMean)) / (newCount - 1);
      } else {
        // General case: M2_old = existing.var * (oldCount - 1)
        const m2Old = existing.var * (oldCount - 1);
        const m2New = m2Old + delta * (value - newMean);
        newVar = m2New / (newCount - 1);
      }

      summary[metricName] = {
        mean: newMean,
        min: Math.min(existing.min, value),
        max: Math.max(existing.max, value),
        var: newVar,
        count: newCount,
      };

    }
  }

  // TODO Calculate Overall Score
  // const overallScore = calculateOverallScore(results);
  // if (overallScore !== null) {
  //   summary['Overall Score'] = overallScore;
  // }

  return summary;
}

/**
 * Updates summary results with new scores using rolling updates.
 * Uses Welford's online algorithm for variance calculation.
 */
export function updateSummaryResults(summaries: Record<string, MetricStats> | undefined, scores: Record<string, number>): Record<string, MetricStats> {
  const updated = summaries ? { ...summaries } : {};

  for (const [metricName, value] of Object.entries(scores)) {
    // Skip non-numeric values
    if (typeof value !== 'number' || !isFinite(value)) {
      continue;
    }

    const existing = updated[metricName];

    if (!existing) {
      // First value for this metric
      updated[metricName] = {
        mean: value,
        min: value,
        max: value,
        var: 0,
        count: 1,
      };
    } else {
      // Rolling update using Welford's algorithm
      const oldCount = existing.count;
      const newCount = oldCount + 1;
      const oldMean = existing.mean;
      const delta = value - oldMean;
      const newMean = oldMean + delta / newCount;

      // Calculate variance using Welford's algorithm
      // M2 (sum of squared differences) = variance * (n - 1)
      // When oldCount = 1, existing.var = 0, so M2_old = 0
      // M2_new = M2_old + delta * (value - newMean)
      // variance_new = M2_new / (newCount - 1)
      let newVar: number;
      if (oldCount === 1) {
        // Special case: going from 1 to 2 values
        // M2_old = 0 (variance of 1 value is 0)
        // M2_new = 0 + delta * (value - newMean)
        newVar = (delta * (value - newMean)) / (newCount - 1);
      } else {
        // General case: M2_old = existing.var * (oldCount - 1)
        const m2Old = existing.var * (oldCount - 1);
        const m2New = m2Old + delta * (value - newMean);
        newVar = m2New / (newCount - 1);
      }

      updated[metricName] = {
        mean: newMean,
        min: Math.min(existing.min, value),
        max: Math.max(existing.max, value),
        var: newVar,
        count: newCount,
      };
    }
  }
  return updated;
}
