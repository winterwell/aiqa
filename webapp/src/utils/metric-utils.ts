import type { Metric } from '../common/types/Dataset';
import type Experiment from '../common/types/Experiment';

/**
 * Extract a numeric metric value from an experiment result.
 * Tries metric.id first, then metric.name (scores may be keyed by either).
 * Returns null if the value is missing, invalid, or non-numeric.
 */
export function getMetricValue(result: { scores?: Record<string, any>; errors?: Record<string, any> }, metric: Metric): number | null {
	// Try metric.id first, then fall back to metric.name
	const score = result.scores?.[metric.id] ?? result.scores?.[metric.name];
	const error = result.errors?.[metric.id] ?? result.errors?.[metric.name];
	
	// If there's an error, return null (caller can check errors separately)
	if (error !== undefined && error !== null) {
		return null;
	}
	
	if (score === undefined || score === null) {
		return null;
	}
	
	// Convert to number if needed
	const numericValue = typeof score === 'number' ? score : 
		(typeof score === 'string' && !isNaN(parseFloat(score)) ? parseFloat(score) : null);
	
	if (numericValue === null || isNaN(numericValue) || !isFinite(numericValue)) {
		return null;
	}
	
	return numericValue;
}

/**
 * Extract all numeric values for a metric from experiment results.
 * Returns an array of valid numeric values.
 */
export function extractMetricValues(metric: Metric, results: Experiment['results']): number[] {
	if (!results) return [];
	
	const values: number[] = [];
	results.forEach((result) => {
		const value = getMetricValue(result, metric);
		if (value !== null) {
			values.push(value);
		}
	});
	
	return values;
}

