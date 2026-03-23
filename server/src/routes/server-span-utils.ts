
import Span, { getSpanId, SpanStats } from '../common/types/Span.js';
import SearchQuery from '../common/SearchQuery.js';
import { searchSpans, updateSpan } from '../db/db_es.js';
import {
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_OUTPUT_TOKENS,
  GEN_AI_USAGE_TOTAL_TOKENS,
  GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
  GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
  GEN_AI_SERVER_TIME_TO_FIRST_OUTPUT_TOKEN,
  GEN_AI_COST_USD,
} from '../common/constants_otel.js';

const TRACE_PARTIAL = 'trace.partial';
const TRACE_PARTIAL_REASON = 'trace.partial.reason';
const CHILD_FETCH_LIMIT = 5000;
const CHILD_FETCH_TRUNCATION_REASON = `child span lookup truncated at ${CHILD_FETCH_LIMIT} results`;

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
    cacheCreationTokens: _add(a.cacheCreationTokens, b.cacheCreationTokens),
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
    cachedInputTokens: toNumber(attrs[GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]),
    cacheCreationTokens: toNumber(attrs[GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS]),
    totalTokens: toNumber(attrs[GEN_AI_USAGE_TOTAL_TOKENS]),
    cost: toNumber(attrs[GEN_AI_COST_USD]),
    timeToFirstOutputToken: toNumber(attrs[GEN_AI_SERVER_TIME_TO_FIRST_OUTPUT_TOKEN]),
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

function isTracePartial(span: Span): boolean {
  return Boolean(span.attributes?.[TRACE_PARTIAL]);
}

function getTracePartialReason(span: Span): string | undefined {
  const reason = span.attributes?.[TRACE_PARTIAL_REASON];
  return typeof reason === 'string' && reason.trim().length > 0 ? reason : undefined;
}

function mergeReasons(existingReason: string | undefined, newReason: string | undefined): string | undefined {
  const parts = [existingReason, newReason]
    .filter((s): s is string => Boolean(s && s.trim().length > 0))
    .flatMap(s => s.split(' | ').map(p => p.trim()).filter(Boolean));
  const unique = Array.from(new Set(parts));
  return unique.length > 0 ? unique.join(' | ') : undefined;
}

function setTracePartial(span: Span, reason: string): boolean {
  const mutableSpan = span as any;
  const attrs = mutableSpan.attributes || (mutableSpan.attributes = {});
  const oldPartial = Boolean(attrs[TRACE_PARTIAL]);
  const oldReason = typeof attrs[TRACE_PARTIAL_REASON] === 'string' ? attrs[TRACE_PARTIAL_REASON] : undefined;
  const mergedReason = mergeReasons(oldReason, reason);
  attrs[TRACE_PARTIAL] = true;
  if (mergedReason) {
    attrs[TRACE_PARTIAL_REASON] = mergedReason;
  }
  return !oldPartial || oldReason !== attrs[TRACE_PARTIAL_REASON];
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
        searchQuery: SearchQuery.setProp(null, 'id', parentId),
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
    const parentIdsForThisFetch = [...idsToResolveChildren];
    // load child spans
    const result = await searchSpans({
      // Must repeat parent: on each id — join(" OR ") alone yields parent:a OR b (b is not a parent filter).
      searchQuery: SearchQuery.setPropOr(null, 'parent', idsToResolveChildren),
      organisation,
      limit: CHILD_FETCH_LIMIT,
      offset: 0,
      _source_includes: ['id', 'parent', 'trace', 'organisation', 'attributes', 'stats', '_childStats'],
      _source_excludes: undefined
  });
    if (result.total > result.hits.length) {
      console.warn(`propagateTokenCostsToRootSpan: child fetch truncated (${result.hits.length}/${result.total}) for ${parentIdsForThisFetch.length} parent span(s)`);
      for (const parentId of parentIdsForThisFetch) {
        const parentSpan = spanMap.get(parentId);
        if (parentSpan) {
          setTracePartial(parentSpan, CHILD_FETCH_TRUNCATION_REASON);
        }
      }
    }
    idsToResolveChildren = [];
    for(const child of result.hits) {
      if (spanMap.has(child.id)) {
        continue;
      }
      spanMap.set(child.id, child);
      const parentSpan = spanMap.get(child.parent);
      // if (parentSpan?._childStats?.[child.id]) {
      //   console.log(`propagateTokenCostsToRootSpan: child ${child.id} - parent ${parentSpan.id} already has stats, skipping fetch`);
      // Commented out due to bug: if the child has updated with later counts, then this parent's snapshot of _childStats will be stale.
      // } else {
      idsToResolveChildren.push(child.id);
      // }
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

/** Result of processSpan: stats for the span and the latest end time in its subtree (for effective duration). */
interface ProcessSpanResult {
  stats: SpanStats;
  /** Max of span.end and all descendants' end (epoch ms). Used to compute trace duration when children end after parent. */
  treeEnd: number;
  /** Effective first output token epoch ms for this subtree (absolute time). */
  treeFirstTokenEpochMs?: number;
  /** Whether this subtree is partial due to truncated child fetching. */
  treePartial: boolean;
  /** Reason(s) for partial subtree. */
  treePartialReason?: string;
}

/**
 * Recursively process a span and all its children, updating the span's token usage stats.
 * Also computes treeEnd so root span duration can reflect full subtree (fixes SDKs that end parent before children).
 * - TODO Set usage on span = own + sum(children), using _seen to avoid having to load all spans from database, 
 * and also avoid double-counting.
 */
const processSpan = (span: Span, childrenMap: Map<string, Span[]>, processedSpans: Set<string>, modifiedSpans: Set<Span>): ProcessSpanResult | null => {
  const spanId = getSpanId(span);
  if (!spanId) return null;
  if (processedSpans.has(spanId)) { // paranoia against a malicious user creating a cycle
    console.warn(`propagateTokenCostsToRootSpan: span ${spanId} processed multiple times, possible cycle or duplicate`);
    const ownStats = getSpanStatsFromAttributes(span);
    const ownTimeToFirstSeconds = ownStats.timeToFirstOutputToken;
    const ownFirstTokenEpochMs = (ownTimeToFirstSeconds !== undefined && ownTimeToFirstSeconds !== null && isFinite(ownTimeToFirstSeconds))
      ? span.start + ownTimeToFirstSeconds * 1000
      : undefined;
    const end = typeof span.end === 'number' ? span.end : 0;
    return {
      stats: ownStats,
      treeEnd: end,
      treeFirstTokenEpochMs: ownFirstTokenEpochMs,
      treePartial: isTracePartial(span),
      treePartialReason: getTracePartialReason(span),
    };
  }
  processedSpans.add(spanId);
console.log(`processSpan: span ${spanId} ...`);
  const ownStats = getSpanStatsFromAttributes(span);
  const ownTimeToFirstSeconds = ownStats.timeToFirstOutputToken;
  const ownFirstTokenEpochMs = (ownTimeToFirstSeconds !== undefined && ownTimeToFirstSeconds !== null && isFinite(ownTimeToFirstSeconds))
    ? span.start + ownTimeToFirstSeconds * 1000
    : undefined;
  const childStatsMap = span._childStats || (span._childStats = {});

  const children = childrenMap.get(spanId) || [];
  console.log(`processSpan: span ${spanId} has children: ${children.map(child => getSpanId(child)).join(',')}`);

  // Latest end in subtree (self + descendants). Handles async SDKs where child ends after parent.
  let treeEnd = typeof span.end === 'number' ? span.end : 0;
  // Effective first output token for this subtree.
  // Precedence rule: if this span has its own `time_to_first_output_token`, it wins over descendants.
  let treeFirstTokenEpochMs: number | undefined = ownFirstTokenEpochMs;
  let treePartial = isTracePartial(span);
  let treePartialReason = getTracePartialReason(span);
  for (const child of children) {
    const childResult = processSpan(child, childrenMap, processedSpans, modifiedSpans);
    const childId = getSpanId(child);
    if (!childId) {
      console.warn(`propagateTokenCostsToRootSpan: Missing id from child span ${child}`);
      continue;
    }
    if (childResult) {
      childStatsMap[childId] = childResult.stats;
      if (childResult.treeEnd > treeEnd) treeEnd = childResult.treeEnd;
      if (ownFirstTokenEpochMs === undefined && childResult.treeFirstTokenEpochMs !== undefined) {
        treeFirstTokenEpochMs = treeFirstTokenEpochMs === undefined
          ? childResult.treeFirstTokenEpochMs
          : Math.min(treeFirstTokenEpochMs, childResult.treeFirstTokenEpochMs);
      }
      if (childResult.treePartial) {
        treePartial = true;
        treePartialReason = mergeReasons(treePartialReason, childResult.treePartialReason);
      }
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

  // When a child ends after this span (common with async SDKs e.g. Go OTel), use subtree end for duration so trace stats are correct.
  const spanEnd = typeof span.end === 'number' ? span.end : 0;
  totalUsage.duration = (treeEnd > spanEnd)
    ? treeEnd - span.start
    : (span.stats?.duration ?? (spanEnd && span.start ? spanEnd - span.start : undefined));

  // Store time-to-first-output-token relative to this span start.
  if (treeFirstTokenEpochMs !== undefined && isFinite(treeFirstTokenEpochMs)) {
    const deltaMs = treeFirstTokenEpochMs - span.start;
    if (deltaMs >= 0) {
      totalUsage.timeToFirstOutputToken = deltaMs / 1000;
    }
  }
  let partialAttributesChanged = false;
  if (treePartial) {
    partialAttributesChanged = setTracePartial(span, treePartialReason || CHILD_FETCH_TRUNCATION_REASON);
  }

  // modified?
  // Note: counts can only ever increase, so if totals match, then the child stats match too
  if (!isEqual(span.stats, totalUsage) || partialAttributesChanged) {
    span.stats = totalUsage;
    modifiedSpans.add(span);
    console.log(`processSpan: span ${spanId} modified, adding to modifiedSpans: ${JSON.stringify(totalUsage)}`);
  } else {
    console.log(`No change for: span ${spanId} stats match, skipping update totalUsage: ${JSON.stringify(totalUsage)}`);
  }
  return { stats: totalUsage, treeEnd, treeFirstTokenEpochMs, treePartial, treePartialReason };
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
    a.cacheCreationTokens === b.cacheCreationTokens &&
    a.totalTokens === b.totalTokens &&
    a.cost === b.cost &&
    a.timeToFirstOutputToken === b.timeToFirstOutputToken &&
    a.errors === b.errors &&
    a.descendants === b.descendants &&
    a.duration === b.duration;
}