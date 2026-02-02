import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { searchSpans } from '../api';
import { Span } from '../common/types';
import { getTraceId } from '../utils/span-utils';

const STALE_TIME = 5 * 60 * 1000; // 5 minutes
const BATCH_SIZE = 10;

/**
 * Load spans for a single trace (lazy loading with caching).
 * Uses useQuery for automatic caching and refetching.
 */
export function useTraceSpans(
  organisationId: string | undefined,
  traceId: string | undefined,
  options?: {
    enabled?: boolean;
    fields?: string;
    exclude?: string;
  }
) {
  return useQuery({
    queryKey: ['trace-spans', organisationId, traceId, options?.fields, options?.exclude],
    queryFn: async () => {
      if (!organisationId || !traceId) return [];
      const result = await searchSpans({
        organisationId,
        query: `trace_id:${traceId}`,
        limit: 1000,
        offset: 0,
        fields: options?.fields || '*',
        exclude: options?.exclude,
      });
      return result.hits || [];
    },
    enabled: !!organisationId && !!traceId && (options?.enabled !== false),
    staleTime: STALE_TIME,
  });
}

/**
 * Load spans in batches and group by traceId.
 * Processes batches sequentially to avoid overwhelming the API.
 */
async function createBatchLoader<T>(
  queryClient: ReturnType<typeof useQueryClient>,
  organisationId: string,
  traceIds: string[],
  options: { fields?: string; exclude?: string },
  batchQueryFn: (batch: string[], traceIdQuery: string) => Promise<Span[]>,
  cacheKeyPrefix: string,
  accumulator: (resultMap: Map<string, T>, spans: Span[]) => void
): Promise<Map<string, T>> {
  const resultMap = new Map<string, T>();
  
  for (let i = 0; i < traceIds.length; i += BATCH_SIZE) {
    const batch = traceIds.slice(i, i + BATCH_SIZE);
    const traceIdQuery = batch.map(id => `trace_id:${id}`).join(' OR ');
    const sortedBatch = [...batch].sort();
    const cacheKey = [cacheKeyPrefix, organisationId, sortedBatch.join(','), options.fields, options.exclude];
    
    const spans = await queryClient.fetchQuery({
      queryKey: cacheKey,
      queryFn: () => batchQueryFn(batch, traceIdQuery),
      staleTime: STALE_TIME,
    });
    
    accumulator(resultMap, spans);
  }
  
  return resultMap;
}

/**
 * Load root spans for multiple traces (lazy loading with caching).
 * Returns a map of traceId -> root span.
 */
export function useRootSpansForTraces(
  organisationId: string | undefined,
  traceIds: string[],
  options?: {
    enabled?: boolean;
    fields?: string;
    exclude?: string;
  }
) {
  const queryClient = useQueryClient();
  
  return useQuery({
    queryKey: ['root-spans', organisationId, traceIds.sort().join(','), options?.fields, options?.exclude],
    queryFn: async () => {
      if (!organisationId || traceIds.length === 0) return new Map<string, Span>();
      
      return createBatchLoader(
        queryClient,
        organisationId,
        traceIds,
        { fields: options?.fields, exclude: options?.exclude },
        async (batch, traceIdQuery) => {
          const result = await searchSpans({
            organisationId,
            query: `(${traceIdQuery}) AND parent_span_id:unset`,
            limit: batch.length,
            offset: 0,
            fields: options?.fields,
            exclude: options?.exclude,
          });
          return result.hits || [];
        },
        'root-spans-batch',
        (resultMap: Map<string, Span>, spans: Span[]) => {
          spans.forEach((span: Span) => {
            const traceId = getTraceId(span);
            if (traceId) {
              resultMap.set(traceId, span);
            }
          });
        }
      );
    },
    enabled: !!organisationId && traceIds.length > 0 && (options?.enabled !== false),
    staleTime: STALE_TIME,
  });
}

/**
 * Load all spans for multiple traces (lazy loading with caching).
 * Returns a map of traceId -> spans array.
 */
export function useSpansForTraces(
  organisationId: string | undefined,
  traceIds: string[],
  options?: {
    enabled?: boolean;
    fields?: string;
    exclude?: string;
  }
) {
  const queryClient = useQueryClient();
  
  return useQuery({
    queryKey: ['all-spans', organisationId, traceIds.sort().join(','), options?.fields, options?.exclude],
    queryFn: async () => {
      if (!organisationId || traceIds.length === 0) return new Map<string, Span[]>();
      
      return createBatchLoader(
        queryClient,
        organisationId,
        traceIds,
        { fields: options?.fields, exclude: options?.exclude },
        async (batch, traceIdQuery) => {
          const result = await searchSpans({
            organisationId,
            query: traceIdQuery,
            limit: 1000,
            offset: 0,
            fields: options?.fields || '*',
            exclude: options?.exclude,
          });
          return result.hits || [];
        },
        'all-spans-batch',
        (resultMap: Map<string, Span[]>, spans: Span[]) => {
          spans.forEach((span: Span) => {
            const traceId = getTraceId(span);
            if (traceId) {
              if (!resultMap.has(traceId)) {
                resultMap.set(traceId, []);
              }
              resultMap.get(traceId)!.push(span);
            }
          });
        }
      );
    },
    enabled: !!organisationId && traceIds.length > 0 && (options?.enabled !== false),
    staleTime: STALE_TIME,
  });
}

/**
 * Get conversation ID from a span's attributes.
 */
export function getConversationId(span: Span): string | null {
  const attributes = (span as any).attributes || {};
  return attributes['gen_ai.conversation.id'] as string | null | undefined || null;
}

/**
 * Load trace IDs for a conversation (lazy loading with caching).
 */
export function useConversationTraceIds(
  organisationId: string | undefined,
  conversationId: string | undefined,
  options?: {
    enabled?: boolean;
  }
) {
  return useQuery({
    queryKey: ['conversation-trace-ids', organisationId, conversationId],
    queryFn: async () => {
      if (!organisationId || !conversationId) return [];
      
      // Query for root spans with this conversation ID
      const result = await searchSpans({
        organisationId,
        query: `attributes.gen_ai\\.conversation\\.id:${conversationId} AND parent_span_id:unset`,
        limit: 1000,
        offset: 0,
        // Only need traceId, so exclude attributes to save bandwidth
        exclude: 'attributes',
      });
      
      // Extract unique trace IDs
      const traceIds = new Set<string>();
      (result.hits || []).forEach((span: Span) => {
        const traceId = getTraceId(span);
        if (traceId) {
          traceIds.add(traceId);
        }
      });
      
      return Array.from(traceIds);
    },
    enabled: !!organisationId && !!conversationId && (options?.enabled !== false),
    staleTime: STALE_TIME,
  });
}

/**
 * Main hook for managing span data with support for single or multiple traces.
 * Handles lazy loading, caching, and conversation expansion.
 */
export function useSpanData(
  organisationId: string | undefined,
  traceIds: string[],
  options?: {
    enabled?: boolean;
    fields?: string;
    exclude?: string;
  }
) {
  // Use traceIds directly - no need for internal state management
  
  // Load root spans for all traces (lightweight, for overview)
  const rootSpansQuery = useRootSpansForTraces(organisationId, traceIds, {
    enabled: options?.enabled,
    fields: options?.fields,
    exclude: options?.exclude || 'attributes.input,attributes.output',
  });
  
  // Load all spans for all traces (full data, lazy loaded)
  const allSpansQuery = useSpansForTraces(organisationId, traceIds, {
    enabled: options?.enabled,
    fields: options?.fields || '*',
    exclude: options?.exclude,
  });
  
  // Get conversation ID from first trace's root span
  const conversationId = useMemo(() => {
    if (rootSpansQuery.data && traceIds.length > 0) {
      const firstTraceId = traceIds[0];
      const rootSpan = rootSpansQuery.data.get(firstTraceId);
      if (rootSpan) {
        return getConversationId(rootSpan);
      }
    }
    return null;
  }, [rootSpansQuery.data, traceIds]);
  
  return {
    rootSpans: rootSpansQuery.data || new Map(),
    allSpans: allSpansQuery.data || new Map(),
    isLoadingRootSpans: rootSpansQuery.isLoading,
    isLoadingAllSpans: allSpansQuery.isLoading,
    conversationId,
  };
}

