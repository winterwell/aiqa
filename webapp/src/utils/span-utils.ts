import { Span } from "../common/types";
import { getSpanId, getTraceId, getParentSpanId } from "../common/types/Span";
import type Metric from "../common/types/Metric";
import {
	DURATION_METRIC_ID,
	TOTAL_TOKENS_METRIC_ID,
	COST_METRIC_ID,
	TIME_TO_FIRST_TOKEN_METRIC_ID,
	SPAN_COUNT_METRIC_ID,
} from "../common/defaultSystemMetrics";

/** Pick display unit for a duration in ms. */
function getDurationUnits(durationMs: number): 'ms' | 's' | 'm' | 'h' | 'd' {
	if (durationMs >= 86400000) return 'd';
	if (durationMs >= 3600000) return 'h';
	if (durationMs >= 60000) return 'm';
	if (durationMs >= 1000) return 's';
	return 'ms';
}
export { getDurationUnits };


/**
 * 
 * @param durationMs MUST be in milliseconds
 * @param outputUnits 
 * @returns 
 */
export function durationString(durationMs: number | null | undefined, outputUnits: 'ms' | 's' | 'm' | 'h' | 'd' | null = null): string {
	if (durationMs === null || durationMs === undefined) return '';
	// if units is unset, pick the most appropriate unit
	if (outputUnits === null) {
		outputUnits = getDurationUnits(durationMs);
	}
	// switch by unit
	if (outputUnits === 'ms') return `${Math.round(durationMs)}ms`;
	if (outputUnits === 's') return `${(durationMs / 1000).toFixed(2)}s`;
	if (outputUnits === 'm') {
		const minutes = Math.floor(durationMs / 60000);
		const seconds = ((durationMs % 60000) / 1000).toFixed(0);
		return `${minutes}m ${seconds}s`;
	}
	if (outputUnits === 'h') return `${Math.round(durationMs / 3600000)}h`;
	if (outputUnits === 'd') return `${Math.round(durationMs / 86400000)}d`;
	return '';
}

/**
 * Format cost in USD with appropriate precision.
 * For costs < $0.01: 4 decimal places
 * For costs < $1: 3 decimal places
 * For costs >= $1: 2 decimal places
 */
export function formatCost(value: number | null | undefined): string {
	if (value === null || value === undefined || isNaN(value)) return '';
	if (value < 0.01) {
		return `$${value.toFixed(4)}`;
	} else if (value < 1) {
		return `$${value.toFixed(3)}`;
	} else {
		return `$${value.toFixed(2)}`;
	}
}

/**
 * Format a number nicely for display.
 * For large integers (>= 1000), uses locale formatting with commas.
 * For smaller numbers or decimals, uses 3 significant figures.
 * Examples: 123 -> "123", 1234 -> "1,234", 0.00123 -> "0.00123", 0.000123 -> "0.000123"
 */
export function prettyNumber(num: number | null | undefined | string): string {
  // Handle null/undefined
  if (num === null || num === undefined) return 'N/A';
  
  // Convert to number if it's a string
  if (typeof num === 'string') {
    // Remove leading zeros that might cause issues
    const trimmed = num.trim();
    if (trimmed === '') return 'N/A';
    const parsed = Number(trimmed);
    if (isNaN(parsed)) return trimmed; // Return original if can't parse
    num = parsed;
  }
  
  // Ensure it's a number type
  if (typeof num !== 'number') {
    const parsed = Number(num);
    if (isNaN(parsed)) return String(num);
    num = parsed;
  }
  
  // Handle NaN and zero
  if (isNaN(num)) return 'N/A';
  if (num === 0) return '0';
  
  // For large integers (>= 1000), use locale formatting
  if (Number.isInteger(num) && Math.abs(num) >= 1000) {
    return num.toLocaleString();
  }
  
  // For smaller numbers or decimals, use 3 significant figures
  const absNum = Math.abs(num);
  if (absNum >= 1) {
    // For numbers >= 1, format with commas if needed
    const rounded = parseFloat(num.toPrecision(3));
    if (Number.isInteger(rounded) && Math.abs(rounded) >= 1000) {
      return rounded.toLocaleString();
    }
    return rounded.toString();
  } else {
    // For numbers < 1, use precision formatting
    return parseFloat(num.toPrecision(3)).toString();
  }
}


  const asTime = (time: number | Date | [number, number] | null | undefined): Date | null => {
	if ( ! time) return null;
	if (typeof time === 'number') {
		return new Date(time);
	}
	if (time instanceof Date) {
		return time;
	}
	if (Array.isArray(time)) {
		// HrTime format: [seconds, nanoseconds]
		return new Date(time[0] * 1000 + time[1] / 1000000);
	}
	// Should never reach here, but satisfy TypeScript
	return null;
  };

export const getStartTime = (span: Span) => {
	return asTime(span.start); 
  };

export const getEndTime = (span: Span) => {
	return asTime(span.end); 
  };

export const getDurationMs = (span: Span): number | null => {
    const start = getStartTime(span);
    const end = getEndTime(span);
    if ( ! start || ! end) return null;
    return end.getTime() - start.getTime();
  };

/**
 * Extract value for a system metric from a span's stats.
 * Returns null for custom metrics (computed during experiments, not stored on spans).
 * TODO DRY with getMetricValue and code in ExperimentDetailsPage.tsx
 */
export function getSpanMetricValue(span: Span, metric: Metric): number | null {
	const stats = span.stats;
	if (!stats) return null;
	const id = metric.id || metric.name;
	if (!id) return null;
	switch (id) {
		case DURATION_METRIC_ID:
			return getDurationMs(span) ?? stats.duration ?? null;
		case TOTAL_TOKENS_METRIC_ID:
			return stats.totalTokens ?? null;
		case COST_METRIC_ID:
			return stats.cost ?? null;
		case TIME_TO_FIRST_TOKEN_METRIC_ID:
			return stats.timeToFirstOutputToken ?? null;
		case SPAN_COUNT_METRIC_ID:
			// Total span count = descendants + self
			const d = stats.descendants;
			return d != null ? d + 1 : null;
		default:
			return null;
	}
}

/** Format a metric value for display based on metric.unit
 * TODO DRY with getMetricValue and code in ExperimentDetailsPage.tsx
 */
export function formatMetricValue(metric: Metric, value: number | null | undefined): string {
	if (value === null || value === undefined) return '—';
	switch (metric.unit) {
		case 'ms':
			return durationString(value);
		case 'USD':
			return formatCost(value);
		case 'tokens':
		case 'spans':
			return prettyNumber(value);
		case 'fraction':
			return (100 * value).toFixed(1) + '%';
		default:
			return prettyNumber(value) + (metric.unit ? ` ${metric.unit}` : '');
	}
}

/**
 * Safely convert a value to a number, handling both string and number types.
 * Prevents string concatenation bugs when adding token values.
 */
function toNumber(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'number') {
    return isNaN(value) ? null : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

export const isRootSpan = (span: Span): boolean => {
  return ! getParentSpanId(span);
};


interface SpanTree {
  span: Span;
  children: SpanTree[];
}

/**
 * Organize spans into trees by trace-id.
 * Returns a map of trace-id to the root span tree(s) for that trace.
 */
export function organizeSpansByTraceId(spans: Span[]): Map<string, SpanTree[]> {
  const traceMap = new Map<string, Span[]>();
  
  // Group spans by trace-id
  spans.forEach(span => {
    const traceId = getTraceId(span);
    if (traceId) {
      if (!traceMap.has(traceId)) {
        traceMap.set(traceId, []);
      }
      traceMap.get(traceId)!.push(span);
    }
  });

  const result = new Map<string, SpanTree[]>();

  // For each trace, organize spans into tree(s)
  traceMap.forEach((traceSpans, traceId) => {
    const roots = traceSpans.filter(span => isRootSpan(span));
    const trees = roots.map(root => organizeSpansIntoTree(traceSpans, root));
    result.set(traceId, trees.filter((t): t is SpanTree => t !== null));
  });

  return result;
}

function organizeSpansIntoTree(spans: Span[], parent: Span): SpanTree | null {
  const parentId = getSpanId(parent);
  const childSpans = spans.filter(span => {
    const spanParentId = getParentSpanId(span);
    if (!spanParentId) return false;
    return spanParentId === parentId;
  });

  return {
    span: parent,
    children: childSpans.map(childSpan => organizeSpansIntoTree(spans, childSpan)).filter((child): child is SpanTree => child !== null),
  };
}
