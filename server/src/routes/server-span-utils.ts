import { createHash } from 'crypto';
import Span, { getSpanId } from '../common/types/Span.js';
import SearchQuery from '../common/SearchQuery.js';
import { searchSpans, updateSpan } from '../db/db_es.js';
import {
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_OUTPUT_TOKENS,
  GEN_AI_USAGE_TOTAL_TOKENS,
  GEN_AI_USAGE_CACHED_INPUT_TOKENS,
  GEN_AI_COST_USD,
  GEN_AI_ERRORS,
} from '../common/constants_otel.js';

/**
 * Safely convert a value to a number, handling both string and number types.
 * Prevents string concatenation bugs when adding token values.
 * @param defaultValue - Value to return if input is undefined/null/invalid. Omit to return undefined for missing values.
 */
export function toNumber(value: unknown, defaultValue?: number): number | undefined {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

/** Span ID to compact hash for _seen (loaded parents: avoid double-count when adding late-arriving children). */
function spanIdToHash(spanId: string | undefined): number | null {
  if (!spanId) return null;
  const hash = createHash('sha256').update(spanId).digest();
  return hash.readInt32BE(0);
}

export interface TokenStats {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  cost: number;
  errors: number;
}

/**
 * Note: unset could mean a rate-limit blocked tracing. This is handled separately by tracking rate-limits.
 */
const ZERO_STATS: TokenStats = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, cost: 0, errors: 0 };

function addTokenStats(a: TokenStats, b: TokenStats): TokenStats {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: a.cost + b.cost,
    errors: a.errors + b.errors,
  };
}

function hasUsage(s: TokenStats): boolean {
  return s.inputTokens > 0 || s.outputTokens > 0 || s.cachedInputTokens > 0 || s.totalTokens > 0 || s.cost > 0 || s.errors > 0;
}

/**
 * Get the span's own error status (not including propagated errors from children).
 */
function getOwnErrorStatus(span: Span): number {
  const spanAny = span as any;
  const statusCode = spanAny?.status?.code ?? 0;
  return statusCode === 2 ? 1 : 0; // STATUS_CODE_ERROR = 2
}

/**
 * Get token usage values from a span's attributes.
 * For spans in batch: recalculates from status (ignores stored errors).
 * For loaded parents: uses stored errors if available.
 */
export function getTokenUsage(span: Span): TokenStats {
  const attrs = span.attributes || {};
  // If errors are stored in attributes (from propagation), use that; otherwise use own error status
  const storedErrors = toNumber(attrs[GEN_AI_ERRORS]);
  const ownError = getOwnErrorStatus(span);
  const errors = storedErrors !== undefined ? storedErrors : ownError;
  return {
    inputTokens: toNumber(attrs[GEN_AI_USAGE_INPUT_TOKENS], 0),
    outputTokens: toNumber(attrs[GEN_AI_USAGE_OUTPUT_TOKENS], 0),
    cachedInputTokens: toNumber(attrs[GEN_AI_USAGE_CACHED_INPUT_TOKENS], 0),
    totalTokens: toNumber(attrs[GEN_AI_USAGE_TOTAL_TOKENS], 0),
    cost: toNumber(attrs[GEN_AI_COST_USD], 0),
    errors,
  };
}

/**
 * Set (overwrite) token usage on a span's attributes.
 * Used when propagating so parent = own + sum(children) without double-counting.
 */
export function setTokenUsageOnSpan(span: Span, usage: TokenStats): void {
  const mutableSpan = span as any;
  if (!mutableSpan.attributes) {
    mutableSpan.attributes = {};
  }
  const attrs = mutableSpan.attributes;
  attrs[GEN_AI_USAGE_INPUT_TOKENS] = usage.inputTokens;
  attrs[GEN_AI_USAGE_OUTPUT_TOKENS] = usage.outputTokens;
  attrs[GEN_AI_USAGE_CACHED_INPUT_TOKENS] = usage.cachedInputTokens;
  attrs[GEN_AI_USAGE_TOTAL_TOKENS] = usage.totalTokens;
  attrs[GEN_AI_COST_USD] = usage.cost;
  attrs[GEN_AI_ERRORS] = usage.errors;
}

/**
 * Add token usage values to a span's attributes (aggregates with existing).
 * For errors, uses max logic to avoid double counting.
 */
export function addTokenUsageToSpan(span: Span, usage: TokenStats): void {
  const existing = getTokenUsage(span);
  const ownError = getOwnErrorStatus(span);
  // For errors: max(own error, existing stored errors, new children errors)
  // This ensures we don't double count and always count own error if present
  const errors = Math.max(ownError, existing.errors, usage.errors);
  const combined: TokenStats = {
    ...addTokenStats(existing, usage),
    errors,
  };
  setTokenUsageOnSpan(span, combined);
}

/**
 * Dependencies for propagateTokenCostsToRootSpan (for testing/mocking)
 */
export interface PropagateTokenCostsDependencies {
  searchSpans: (query: SearchQuery | string, organisation: string, limit: number, offset: number, includes?: string[] | null, excludes?: string[] | null) => Promise<{ hits: Span[]; total: number }>;
  updateSpan: (spanId: string, updates: Partial<Span>, organisation: string) => Promise<Span | null>;
}

/**
 * Propagate token costs from child spans to their parent spans, all the way up to root spans.
 *
 * 1. Separates spans into span-trees (one tree per root span)
 * 2. Finds spans referenced as parents but not present in the batch - loads them
 * 3. Processes from leaf nodes up to root, updating parent token-cost stats
 * 4. Spans in this batch: parent = own + sum(children). Loaded parents: add this batch's children's usage (use _seen so late-arriving batches don't lose earlier counts or double-count on replay).
 */
export async function propagateTokenCostsToRootSpan(
  spans: Span[],
  deps?: Partial<PropagateTokenCostsDependencies>
): Promise<void> {
  if (spans.length === 0) return;

  const searchSpansFn = deps?.searchSpans || searchSpans;
  const updateSpanFn = deps?.updateSpan || updateSpan;

  const organisation = spans[0].organisation;
  if (!organisation) {
    console.warn('propagateTokenCostsToRootSpan: spans missing organisation');
    return;
  }

  const spanIdsInBatch = new Set<string>();
  const spanMap = new Map<string, Span>();
  for (const span of spans) {
    const spanId = getSpanId(span);
    if (spanId) {
      spanIdsInBatch.add(spanId);
      spanMap.set(spanId, span);
    } else {
      throw new Error(`propagateTokenCostsToRootSpan: span missing id! ${span}`);
    }
  }

  const missingParentIds = new Set<string>();
  for (const span of spans) {
    const parentSpanId = (span as any).parent;
    if (parentSpanId && !spanMap.has(parentSpanId)) {
      missingParentIds.add(parentSpanId);
    }
  }

  const loadedParents = new Map<string, Span>();
  const toLoad = Array.from(missingParentIds);
  while (toLoad.length > 0) {
    const parentId = toLoad.pop()!;
    if (loadedParents.has(parentId) || spanMap.has(parentId)) continue;
    try {
      const result = await searchSpansFn(
        new SearchQuery(`id:${parentId}`),
        organisation,
        1,
        0,
        ['id', 'parent', 'trace', 'organisation', 'attributes', '_seen'],
        undefined
      );
      if (result.hits.length > 0) {
        const parent = result.hits[0];
        loadedParents.set(parentId, parent);
        spanMap.set(parentId, parent);
        const grandparentId = (parent as any).parent;
        if (grandparentId && !spanMap.has(grandparentId)) {
          toLoad.push(grandparentId);
        }
      }
    } catch (error) {
      console.warn(`Failed to load parent span ${parentId}:`, error);
    }
  }

  // build the span tree aka childrenMap (parentId -> [children])
  const childrenMap = new Map<string, Span[]>();
  const rootSpans: Span[] = [];
  const allSpans = [...spans, ...Array.from(loadedParents.values())];

  for (const span of allSpans) {
    const spanId = getSpanId(span);
    if (!spanId) {
      throw new Error(`propagateTokenCostsToRootSpan: span missing id in allSpans! ${span.name}`);
    }
    const parentSpanId = (span as any).parent;
    if (!parentSpanId) {
      rootSpans.push(span);
    } else {
      if (!childrenMap.has(parentSpanId)) {
        childrenMap.set(parentSpanId, []);
      }
      childrenMap.get(parentSpanId)!.push(span);
    }
  }

  const processedSpans = new Set<string>();

  /**
   * Recursively process a span and all its children, updating the span's token usage stats.
   * - Span in this batch: set usage = own + sum(children).
   * - Loaded parent: add only children not in _seen (late-arriving batch doesn't overwrite earlier counts; _seen avoids double-count on replay).
   */
  const processSpan = (span: Span): TokenStats => {
    const spanId = getSpanId(span);
    if (!spanId) return ZERO_STATS;
    if (processedSpans.has(spanId)) {
      console.warn(`propagateTokenCostsToRootSpan: span ${spanId} processed multiple times, possible cycle or duplicate`);
      return getTokenUsage(span);
    }
    processedSpans.add(spanId);

    const inBatch = spanIdsInBatch.has(spanId);
    
    // For spans in batch, get own usage from status (ignore stored); for loaded parents, use stored
    const ownError = getOwnErrorStatus(span);
    const ownUsageBase = getTokenUsage(span);
    // For spans in batch, recalculate own usage from status, ignoring stored values
    const ownUsage: TokenStats = inBatch ? {
      ...ownUsageBase,
      errors: ownError, // Use own error status, not stored
    } : ownUsageBase;
    
    const children = childrenMap.get(spanId) || [];
    let childStatsTotal: TokenStats = ZERO_STATS;
    let childStatsNew: TokenStats = ZERO_STATS;
    const mutableSpan = span as any;
    const seenSet = new Set(mutableSpan._seen ?? []);

    for (const child of children) {
      const childSpanId = getSpanId(child);
      if (!childSpanId) continue;
      const childUsage = processSpan(child);
      childStatsTotal = addTokenStats(childStatsTotal, childUsage);
      if (!inBatch) {
        const childHash = spanIdToHash(childSpanId);
        if (childHash !== null && !seenSet.has(childHash)) {
          childStatsNew = addTokenStats(childStatsNew, childUsage);
          seenSet.add(childHash);
        }
      }
    }
    if (!inBatch) {
      mutableSpan._seen = Array.from(seenSet);
    }

    // For errors: max(sum errors in children, 1 if it has an error status itself) to avoid double counting
    const errors = Math.max(ownError, childStatsTotal.errors);
    const combined: TokenStats = {
      ...addTokenStats(ownUsage, childStatsTotal),
      errors,
    };
    try {
      if (inBatch) {
        setTokenUsageOnSpan(span, combined);
      } else if (hasUsage(childStatsNew)) {
        // For loaded parents, addTokenUsageToSpan handles the max logic for errors
        addTokenUsageToSpan(span, childStatsNew);
      }
    } catch (error) {
      console.error(`propagateTokenCostsToRootSpan: failed to update token usage on span ${spanId}:`, error);
    }
    return combined;
  };

  // apply processSpan() to all root spans
  for (const rootSpan of rootSpans) {
    try {
      processSpan(rootSpan);
    } catch (error) {
      console.error(`propagateTokenCostsToRootSpan: failed to process root span ${getSpanId(rootSpan) || 'unknown'}:`, error);
    }
  }

  // save updates
  const updateFailures: string[] = [];
  for (const [parentId, parent] of loadedParents.entries()) {
    try {
      const updates: Partial<Span> = {
        attributes: parent.attributes || {},
        _seen: (parent as any)._seen ?? [],
      };
      const updated = await updateSpanFn(parentId, updates, organisation);
      if (!updated) {
        updateFailures.push(parentId);
        console.warn(`propagateTokenCostsToRootSpan: updateSpan returned null for ${parentId} (span may not exist or belong to different org)`);
      }
    } catch (error) {
      updateFailures.push(parentId);
      console.error(`propagateTokenCostsToRootSpan: failed to update parent span ${parentId}:`, error);
    }
  }
  if (updateFailures.length > 0) {
    console.warn(`propagateTokenCostsToRootSpan: failed to update ${updateFailures.length} parent span(s) in database`);
  }
}
