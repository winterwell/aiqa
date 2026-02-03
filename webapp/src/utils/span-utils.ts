import { Span } from "../common/types";
import { getSpanId, getTraceId, getParentSpanId } from "../common/types/Span";
import { GEN_AI_ERRORS } from "../common/constants_otel";

/** Pick display unit for a duration in ms. */
function getDurationUnits(durationMs: number): 'ms' | 's' | 'm' | 'h' | 'd' {
	if (durationMs >= 86400000) return 'd';
	if (durationMs >= 3600000) return 'h';
	if (durationMs >= 60000) return 'm';
	if (durationMs >= 1000) return 's';
	return 'ms';
}
export { getDurationUnits };



export function durationString(durationMs: number | null | undefined, units: 'ms' | 's' | 'm' | 'h' | 'd' | null = null): string {
	if (durationMs === null || durationMs === undefined) return '';
	// if units is unset, pick the most appropriate unit
	if (units === null) {
		units = getDurationUnits(durationMs);
	}
	// switch by unit
	if (units === 'ms') return `${Math.round(durationMs)}ms`;
	if (units === 's') return `${(durationMs / 1000).toFixed(2)}s`;
	if (units === 'm') {
		const minutes = Math.floor(durationMs / 60000);
		const seconds = ((durationMs % 60000) / 1000).toFixed(0);
		return `${minutes}m ${seconds}s`;
	}
	if (units === 'h') return `${Math.round(durationMs / 3600000)}h`;
	if (units === 'd') return `${Math.round(durationMs / 86400000)}d`;
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

/**
 * Does NOT recurse into children.
 * @param span 
 * @returns 
 */
export const getTotalTokenCount = (span: Span): number | null => {
  const attributes = (span as any).attributes || {};
  // First check standard OpenTelemetry semantic convention attributes
  const totalTokens = toNumber(attributes['gen_ai.usage.total_tokens']);
  if (totalTokens !== null) {
    return totalTokens;
  }
  // Calculate from input + output if total not available
  const inputTokens = toNumber(attributes['gen_ai.usage.input_tokens']);
  const outputTokens = toNumber(attributes['gen_ai.usage.output_tokens']);
  if (inputTokens !== null || outputTokens !== null) {
    return (inputTokens || 0) + (outputTokens || 0);
  }
  // Fallback: check if token info is nested in output.usage (before extraction to standard attributes)
  const output = attributes.output;
  if (output && typeof output === 'object' && output.usage) {
    const usage = output.usage;
    if (typeof usage === 'object') {
      const nestedTotal = toNumber(usage.total_tokens);
      if (nestedTotal !== null) {
        return nestedTotal;
      }
      const nestedInput = toNumber(usage.input_tokens);
      const nestedOutput = toNumber(usage.output_tokens);
      if (nestedInput !== null || nestedOutput !== null) {
        return (nestedInput || 0) + (nestedOutput || 0);
      }
    }
  }
  return null;
};

/** gen_ai.cost.usd if the tracer or server has added it, otherwise calculate from token usage */
export const getCost = (span: Span): number | null => {
  const attributes = (span as any).attributes || {};
  const cost = toNumber(attributes['gen_ai.cost.usd']);
  if (cost !== null) {
    return cost;
  }
  // Check standard OpenTelemetry attributes first
  const inputTokens = toNumber(attributes['gen_ai.usage.input_tokens']);
  const outputTokens = toNumber(attributes['gen_ai.usage.output_tokens']);
  if (inputTokens !== null || outputTokens !== null) {
    // TODO calculate cost from token usage -- should be done server side   
  }
  // Fallback: check if token info is nested in output.usage (before extraction to standard attributes)
  const output = attributes.output;
  if (output && typeof output === 'object' && output.usage) {
    const usage = output.usage;
    if (typeof usage === 'object') {
      const nestedInput = toNumber(usage.input_tokens);
      const nestedOutput = toNumber(usage.output_tokens);
      if (nestedInput !== null || nestedOutput !== null) {
        // TODO calculate cost from token usage -- should be done server side   
      }
    }
  }
   return null; 
};

/** Get error count from aiqa.errors attribute */
export const getErrors = (span: Span): number | null => {
  const attributes = (span as any).attributes || {};
  return toNumber(attributes[GEN_AI_ERRORS]);
};

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

/**
 * Calculate tokens for a span tree without double-counting.
 * Recurses down the tree, but stops recursing when it finds token info at a node.
 * Sums across branches in the tree.
 */
export function calculateTokensForTree(tree: SpanTree): number {
  const tokens = getTotalTokenCount(tree.span);
  
  // If this span has token info, use it and don't recurse into children
  // (to avoid double-counting)
  if (tokens !== null) {
    return tokens;
  }

  // Otherwise, sum tokens from all children branches
  let total = 0;
  for (const child of tree.children) {
    total += calculateTokensForTree(child);
  }
  return total;
}

/**
 * Calculate cost for a span tree without double-counting.
 * Recurses down the tree, but stops recursing when it finds cost info at a node.
 * Sums across branches in the tree.
 */
export function calculateCostForTree(tree: SpanTree): number {
  const cost = getCost(tree.span);
  
  // If this span has cost info, use it and don't recurse into children
  // (to avoid double-counting)
  if (cost !== null) {
    return cost;
  }

  // Otherwise, sum cost from all children branches
  let total = 0;
  for (const child of tree.children) {
    total += calculateCostForTree(child);
  }
  return total;
}
