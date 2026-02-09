
import Span, { getSpanId, SpanStats } from '../common/types/Span.js';
import SearchQuery from '../common/SearchQuery.js';
import { searchSpans, updateSpan } from '../db/db_es.js';
import {
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_OUTPUT_TOKENS,
  GEN_AI_USAGE_TOTAL_TOKENS,
  GEN_AI_USAGE_CACHED_INPUT_TOKENS,
  GEN_AI_COST_USD,
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


function addTokenStats(a: SpanStats, b: SpanStats): SpanStats {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: _add(a.inputTokens, b.inputTokens),
    outputTokens: _add(a.outputTokens, b.outputTokens),
    cachedInputTokens: _add(a.cachedInputTokens, b.cachedInputTokens),
    totalTokens: _add(a.totalTokens, b.totalTokens),
    cost: _add(a.cost, b.cost),
    errors: _add(a.errors, b.errors),
    descendants: _add(a.descendants, b.descendants),
  };
}

function _add(a: number, b: number): number {
  if (a === undefined || a === null) return b;
  if (b === undefined || b === null) return a;
  return a + b;
}

/**
 * Get the span's own error status (not including propagated errors from children).
 */
function hasErrorStatus(span: Span): boolean {
  const spanAny = span as any;
  const statusCode = spanAny?.status?.code ?? 0;
  return statusCode === 2; // STATUS_CODE_ERROR = 2, see otel docs
}

/**
 * Get token usage values from a span's attributes. This does NOT include children stats.
 * This does use status to set errors
 */
export function getSpanStatsFromAttributes(span: Span): SpanStats {
  const attrs = span.attributes || {};
  const errors = hasErrorStatus(span) ? 1 : 0;
  return {
    inputTokens: toNumber(attrs[GEN_AI_USAGE_INPUT_TOKENS]),
    outputTokens: toNumber(attrs[GEN_AI_USAGE_OUTPUT_TOKENS]),
    cachedInputTokens: toNumber(attrs[GEN_AI_USAGE_CACHED_INPUT_TOKENS]),
    totalTokens: toNumber(attrs[GEN_AI_USAGE_TOTAL_TOKENS]),
    cost: toNumber(attrs[GEN_AI_COST_USD]),
    errors,
    // descendants are not included in attributes. We create that for non-leaf spans.
  };
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
 * 2. Finds spans referenced as parents but not present in the batch - loads them. This is recursive to get all ancestors.
 * 3. Processes from leaf nodes up to root, updating parent token-cost stats
 * 4. Spans are modified in place
 * 5. Loaded parent spans are saved here (using update). inBatch spans are NOT saved here.
 * Returns the root spans.
 * 
 * TODO: use a delay and a queue to reduce race conditions
 */
export async function propagateTokenCostsToRootSpan(
  spans: Span[]
): Promise<Span[]> {
  if (spans.length === 0) return [];
  const traceIds = spans.map(span => span.trace);
  const spanIds = spans.map(span => getSpanId(span));
  const tokenStats = spans.map(span => getSpanStatsFromAttributes(span));
  console.log('propagateTokenCostsToRootSpan: traces:' + traceIds + ' spans:', spanIds, "tokenStats:", tokenStats);

  const organisation = spans[0].organisation;
  if (!organisation) {
    console.warn('propagateTokenCostsToRootSpan: spans missing organisation');
    return [];
  }

  const spanIdsInBatch = new Set<string>();
  // map of spanId -> span
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

  // load any missing parent and grandparent spans
  const missingParentIds = new Set<string>();
  for (const span of spans) {
    const parentSpanId = (span as any).parent;
    if (parentSpanId && !spanMap.has(parentSpanId)) {
      missingParentIds.add(parentSpanId);
    }
  }
  // Minor TODO: use batch (id1 or id2 or ...) queries to speed this up
  const toLoad = Array.from(missingParentIds);
  while (toLoad.length > 0) {
    const parentId = toLoad.pop()!;
    if (spanMap.has(parentId)) continue;
    try {
      const result = await searchSpans({
        searchQuery: new SearchQuery(`id:${parentId}`),
        organisation,
        limit: 1,
        offset: 0,
        _source_includes: ['id', 'parent', 'trace', 'organisation', 'attributes', 'stats', '_childStats'],
        _source_excludes: undefined
    });
      if (result.hits.length > 0) {
        const parent = result.hits[0];
        spanMap.set(parentId, parent);
        const grandparentId = (parent as any).parent;
        if (grandparentId && !spanMap.has(grandparentId)) {
          console.log(`propagateTokenCostsToRootSpan: request load of grandparent ${grandparentId} for parent ${parentId}`);
          toLoad.push(grandparentId);
        }
      }
    } catch (error) {
      console.warn(`Failed to load parent span ${parentId}:`, error);
    }
  }
  // load child spans for the batch
  let idsToResolveChildren = Array.from(spanIdsInBatch);
  while (idsToResolveChildren.length > 0) {
    // load child spans
    const result = await searchSpans({
      searchQuery: new SearchQuery(`parent:${idsToResolveChildren.join(' OR ')}`),
      organisation,
      limit: 1000,
      offset: 0,
      _source_includes: ['id', 'parent', 'trace', 'organisation', 'attributes', 'stats', '_childStats'],
      _source_excludes: undefined
  });
    idsToResolveChildren = [];
    for(const child of result.hits) {
      if (spanMap.has(child.id)) {
        continue;
      }
      spanMap.set(child.id, child);
      const parentSpan = spanMap.get(child.parent);
      if (parentSpan?._childStats?.[child.id]) {
        console.log(`propagateTokenCostsToRootSpan: child ${child.id} - parent ${parentSpan.id} already has stats, skipping fetch`);
      } else {
        idsToResolveChildren.push(child.id);
      }
    }
  }

  // build the span tree aka childrenMap (parentId -> [children])
  const childrenMap = new Map<string, Span[]>();
  const rootSpans: Span[] = [];
  const allSpans = spanMap.values();

  for (const span of allSpans) {
    const spanId = getSpanId(span);
    if (!spanId) {
      throw new Error(`propagateTokenCostsToRootSpan: span missing id in allSpans! ${span.name}`);
    }
    const parentSpanId = (span as any).parent;
    if (!parentSpanId || !spanMap.has(parentSpanId)) {
      rootSpans.push(span);
    } else {
      if (!childrenMap.has(parentSpanId)) {
        childrenMap.set(parentSpanId, []);
      }
      childrenMap.get(parentSpanId)!.push(span);
    }
  }
  console.log('propagateTokenCostsToRootSpan: toLoad:', toLoad);
  console.log('propagateTokenCostsToRootSpan: allSpans:', [...allSpans].map(span => getSpanId(span)).join(','));
  console.log('propagateTokenCostsToRootSpan: rootSpans:', rootSpans.map(root => getSpanId(root)).join(','));
  console.log('propagateTokenCostsToRootSpan: childrenMap:', childrenMap);

  const processedSpans = new Set<string>();

  const modifiedSpans = new Set<Span>();

  // apply processSpan() to all root spans
  for (const rootSpan of rootSpans) {
    try {
      processSpan(rootSpan, childrenMap, processedSpans, modifiedSpans);
    } catch (error) {
      console.error(`propagateTokenCostsToRootSpan: failed to process root span ${getSpanId(rootSpan) || 'unknown'}:`, error);
    }
  }

  // save updates
  const updateFailures: string[] = [];
  for (const span of modifiedSpans) {
    const spanId = getSpanId(span);
    if (spanIdsInBatch.has(spanId)) {
      console.log(`propagateTokenCostsToRootSpan: span ${spanId} already in batch, skipping update`);
      continue; // assume saved later 
    }
    try {
      const updates: Partial<Span> = {
        stats: span.stats
      };
      if (span._childStats) {
        updates._childStats = span._childStats;
      }
      console.log(`propagateTokenCostsToRootSpan: updating span ${spanId} with updates: ${JSON.stringify(updates)}`);
      const updated = await updateSpan(spanId, updates, organisation);
      if (!updated) {
        updateFailures.push(spanId);
        console.warn(`propagateTokenCostsToRootSpan: updateSpan returned null for ${spanId} (span may not exist or belong to different org)`);
      }
    } catch (error) {
      updateFailures.push(spanId);
      console.error(`propagateTokenCostsToRootSpan: failed to update parent span ${spanId}:`, error);
    }
  }
  if (updateFailures.length > 0) {
    console.warn(`propagateTokenCostsToRootSpan: failed to update ${updateFailures.length} parent span(s) in database`);
  }
  const tokenStatsAfter = spans.map(span => span.stats);
  console.log('DONE propagateTokenCostsToRootSpan: traces:' + traceIds + ' spans:', spanIds, "tokenStats:", tokenStatsAfter);
  return rootSpans;
} // end of propagateTokenCostsToRootSpan

/**
 * Recursively process a span and all its children, updating the span's token usage stats.
 * - TODO Set usage on span = own + sum(children), using _seen to avoid having to load all spans from database, 
 * and also avoid double-counting.
 */
const processSpan = (span: Span, childrenMap: Map<string, Span[]>, processedSpans: Set<string>, modifiedSpans: Set<Span>): SpanStats | null => {
  const spanId = getSpanId(span);
  if (!spanId) return null;
  if (processedSpans.has(spanId)) { // paranoia against a malicious user creating a cycle
    console.warn(`propagateTokenCostsToRootSpan: span ${spanId} processed multiple times, possible cycle or duplicate`);
    return getSpanStatsFromAttributes(span);
  }
  processedSpans.add(spanId);
console.log(`processSpan: span ${spanId} ...`);
  const ownStats = getSpanStatsFromAttributes(span);
  const childStatsMap = span._childStats || (span._childStats = {});

  const children = childrenMap.get(spanId) || [];
  console.log(`processSpan: span ${spanId} has children: ${children.map(child => getSpanId(child)).join(',')}`);
  
  // update child stats
  for (const child of children) {
    const childUsage = processSpan(child, childrenMap, processedSpans, modifiedSpans);
    const childId = getSpanId(child);
    if (!childId) {
      console.warn(`propagateTokenCostsToRootSpan: Missing id from child span ${child}`);
      continue;
    }
    if (childUsage) {
      childStatsMap[childId] = childUsage;
    }
  }
  // sum over children
  let childTotalStats: SpanStats = {};
  for (const childId in childStatsMap) {
    const childStats = childStatsMap[childId];
    childTotalStats = addTokenStats(childTotalStats, childStats);
  }
  const totalUsage = addTokenStats(ownStats, childTotalStats);
  // special case error: if the children had errors, dont cont an error on the parent (because errors often get passed up the tree in code)
  if (hasErrorStatus(span) && totalUsage.errors > 1) {
    totalUsage.errors--;
  }
  // descendants includes the children 
  totalUsage.descendants = _add(childTotalStats.descendants, Object.keys(childStatsMap).length);

  // modified?
  // Note: counts can only ever increase, so if totals match, then the child stats match too
  if (!isEqual(span.stats, totalUsage)) {
    span.stats = totalUsage;
    modifiedSpans.add(span);
    console.log(`processSpan: span ${spanId} modified, adding to modifiedSpans: ${JSON.stringify(totalUsage)}`);
  } else {
    console.log(`No change for: span ${spanId} stats match, skipping update totalUsage: ${JSON.stringify(totalUsage)}`);
  }
  return totalUsage;
}; // end of processSpan()


function isEqual(a: SpanStats, b: SpanStats): boolean {
  if (!a) {
    return !b;
  }
  if (!b) {
    return false;
  }
  return a.inputTokens === b.inputTokens &&
    a.outputTokens === b.outputTokens &&
    a.cachedInputTokens === b.cachedInputTokens &&
    a.totalTokens === b.totalTokens &&
    a.cost === b.cost &&
    a.errors === b.errors &&
    a.descendants === b.descendants;
}