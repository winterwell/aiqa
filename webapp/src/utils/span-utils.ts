import { Span } from "../common/types";

export const getSpanName = (span: Span): string => (span as any).name || '';

export function getDurationUnits(durationMs: number | null | undefined): 'ms' | 's' | 'm' | 'h' | 'd' | null {
	if (durationMs === null || durationMs === undefined) return null;
	if (durationMs < 1000) return 'ms';
	if (durationMs < 60000) return 's';
	if (durationMs < 3600000) return 'm';
	if (durationMs < 86400000) return 'h';
	return 'd';
}

export function durationString(durationMs: number | null | undefined, units: 'ms' | 's' | 'm' | 'h' | 'd' | null = null): string {
	if (durationMs === null || durationMs === undefined) return '';
	// if units is unset, pick the most appropriate unit
	if (units === null) {
		units = getDurationUnits(durationMs);
	}
	// switch by unit
	if (units === 'ms') return `${durationMs}ms`;
	if (units === 's') return `${Math.round(durationMs / 1000)}s`;
	if (units === 'm') return `${Math.round(durationMs / 60000)}m`;
	if (units === 'h') return `${Math.round(durationMs / 3600000)}h`;
	if (units === 'd') return `${Math.round(durationMs / 86400000)}d`;
	return '';
}

/**
 * Format a number to 3 significant figures.
 * Examples: 123 -> "123", 1234 -> "1230", 0.00123 -> "0.00123", 0.000123 -> "0.000123"
 */
export function prettyNumber(num: number | null | undefined): string {
	if (num === null || num === undefined || isNaN(num)) return 'N/A';
	if (num === 0) return '0';
	return parseFloat(num.toPrecision(3)).toString();
}


export const getSpanId = (span: Span) => {
    // Check all possible locations for span ID, in order of preference:
    // 1. clientSpanId (client-set, takes precedence)
    // 2. spanId (direct OpenTelemetry property)
    // 3. span.id (nested property)
    // 4. client_span_id (alternative naming)
    return (span as any).clientSpanId 
        || (span as any).spanId 
        || (span as any).span?.id 
        || (span as any).client_span_id 
        || 'N/A';
  };

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
	return asTime(span.startTime);
  };

export const getEndTime = (span: Span) => {
	return asTime(span.endTime);
  };

export const getDurationMs = (span: Span): number | null => {
    const start = getStartTime(span);
    const end = getEndTime(span);
    if ( ! start || ! end) return null;
    return end.getTime() - start.getTime();
  };

export const getTraceId = (span: Span): string => {
  return (span as any).client_trace_id || (span as any).traceId || (span as any).spanContext?.()?.traceId || '';
};

/**
 * Does NOT recurse into children.
 * @param span 
 * @returns 
 */
export const getTotalTokenCount = (span: Span): number | null => {
  const attributes = (span as any).attributes || {};
  // First check standard OpenTelemetry semantic convention attributes
  const totalTokens = attributes['gen_ai.usage.total_tokens'] as number | undefined;
  if (totalTokens !== undefined) {
    return totalTokens;
  }
  // Calculate from input + output if total not available
  const inputTokens = attributes['gen_ai.usage.input_tokens'] as number | undefined;
  const outputTokens = attributes['gen_ai.usage.output_tokens'] as number | undefined;
  if (inputTokens !== undefined || outputTokens !== undefined) {
    return (inputTokens || 0) + (outputTokens || 0);
  }
  // Fallback: check if token info is nested in output.usage (before extraction to standard attributes)
  const output = attributes.output;
  if (output && typeof output === 'object' && output.usage) {
    const usage = output.usage;
    if (typeof usage === 'object') {
      const nestedTotal = usage.total_tokens as number | undefined;
      if (nestedTotal !== undefined) {
        return nestedTotal;
      }
      const nestedInput = usage.input_tokens as number | undefined;
      const nestedOutput = usage.output_tokens as number | undefined;
      if (nestedInput !== undefined || nestedOutput !== undefined) {
        return (nestedInput || 0) + (nestedOutput || 0);
      }
    }
  }
  return null;
};

/** gen_ai.cost.usd if the tracer or server has added it, otherwise calculate from token usage */
export const getCost = (span: Span): number | null => {
  const attributes = (span as any).attributes || {};
  const cost = attributes['gen_ai.cost.usd'] as number | undefined;
  if (cost !== undefined && cost !== null) {
    return cost;
  }
  // Check standard OpenTelemetry attributes first
  const inputTokens = attributes['gen_ai.usage.input_tokens'] as number | undefined;
  const outputTokens = attributes['gen_ai.usage.output_tokens'] as number | undefined;
  if (inputTokens || outputTokens) {
    // TODO calculate cost from token usage -- should be done server side   
  }
  // Fallback: check if token info is nested in output.usage (before extraction to standard attributes)
  const output = attributes.output;
  if (output && typeof output === 'object' && output.usage) {
    const usage = output.usage;
    if (typeof usage === 'object') {
      const nestedInput = usage.input_tokens as number | undefined;
      const nestedOutput = usage.output_tokens as number | undefined;
      if (nestedInput || nestedOutput) {
        // TODO calculate cost from token usage -- should be done server side   
      }
    }
  }
   return null; 
};

export const isRootSpan = (span: Span): boolean => {
  const parentSpanId = (span as any).parentSpanId || (span as any).span?.parent?.id || null;
  return parentSpanId === null;
};

export const getParentSpanId = (span: Span): string | null => {
  return (span as any).parentSpanId || (span as any).span?.parent?.id || null;
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

function getAllPossibleSpanIds(span: Span): Set<string> {
  const ids = new Set<string>();
  const possibleIds = [
    (span as any).clientSpanId,
    (span as any).spanId,
    (span as any).span?.id,
    (span as any).client_span_id,
  ];
  possibleIds.forEach(id => {
    if (id && id !== 'N/A') {
      ids.add(String(id));
    }
  });
  const spanId = getSpanId(span);
  if (spanId && spanId !== 'N/A') {
    ids.add(spanId);
  }
  return ids;
}

function organizeSpansIntoTree(spans: Span[], parent: Span): SpanTree | null {
  const parentIds = getAllPossibleSpanIds(parent);
  const childSpans = spans.filter(span => {
    const spanParentId = getParentSpanId(span);
    if (!spanParentId) return false;
    return parentIds.has(spanParentId);
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
