import { useMemo } from 'react';
import { Span } from '../../common/types';
import { getTraceId } from '../../common/types/Span.js';
import { getStartTime, getDurationMs, getTotalTokenCount, getCost, isRootSpan, organizeSpansByTraceId, calculateTokensForTree, calculateCostForTree } from '../../utils/span-utils';

interface FeedbackInfo {
  type: 'positive' | 'negative' | 'neutral';
  comment?: string;
}

interface TraceMetrics {
  tokens: {
    total: number;
    avg: number;
    max: number;
  };
  cost: {
    total: number;
    avg: number;
    max: number;
  };
  avgDuration: number;
  positiveFeedback: number;
  negativeFeedback: number;
  count: number;
}

export interface TimeseriesDataPoint {
  time: number;
  duration: number;
  tokens: number;
  cost: number;
  feedback: number;
}

export function useTraceMetrics(
  spans: Span[],
  feedbackMap: Map<string, FeedbackInfo>
): TraceMetrics {
  return useMemo(() => {
    // Organize spans by trace-id to avoid double-counting
    const traceTrees = organizeSpansByTraceId(spans);
    
    const traceTokens: number[] = [];
    const traceCosts: number[] = [];
    let totalDuration = 0;
    let durationCount = 0; // Only count root spans for duration
    let positiveFeedback = 0;
    let negativeFeedback = 0;
    let count = 0;

    // Calculate tokens and cost per trace (without double-counting)
    traceTrees.forEach((trees, traceId) => {
      // Sum tokens/cost across all root trees for this trace
      let traceTokensTotal = 0;
      let traceCostTotal = 0;
      
      for (const tree of trees) {
        traceTokensTotal += calculateTokensForTree(tree);
        traceCostTotal += calculateCostForTree(tree);
      }
      
      if (traceTokensTotal > 0) {
        traceTokens.push(traceTokensTotal);
      }
      if (traceCostTotal > 0) {
        traceCosts.push(traceCostTotal);
      }

      // Count feedback
      const feedback = feedbackMap.get(traceId);
      if (feedback) {
        if (feedback.type === 'positive') positiveFeedback++;
        if (feedback.type === 'negative') negativeFeedback++;
      }
    });

    // Calculate duration for root spans only
    spans.forEach(span => {
      if (isRootSpan(span)) {
        const duration = getDurationMs(span);
        if (duration !== null) {
          totalDuration += duration;
          durationCount++;
        }
      }
    });

    count = traceTrees.size;

    const tokensTotal = traceTokens.reduce((sum, t) => sum + t, 0);
    const tokensAvg = traceTokens.length > 0 ? tokensTotal / traceTokens.length : 0;
    const tokensMax = traceTokens.length > 0 ? Math.max(...traceTokens) : 0;

    const costTotal = traceCosts.reduce((sum, c) => sum + c, 0);
    const costAvg = traceCosts.length > 0 ? costTotal / traceCosts.length : 0;
    const costMax = traceCosts.length > 0 ? Math.max(...traceCosts) : 0;

    return {
      tokens: {
        total: tokensTotal,
        avg: tokensAvg,
        max: tokensMax,
      },
      cost: {
        total: costTotal,
        avg: costAvg,
        max: costMax,
      },
      avgDuration: durationCount > 0 ? totalDuration / durationCount : 0,
      positiveFeedback,
      negativeFeedback,
      count,
    };
  }, [spans, feedbackMap]);
}

export interface DurationHistogramDataPoint {
  duration: number;
  count: number;
}

export interface TokensHistogramDataPoint {
  tokens: number;
  count: number;
}

export interface CostHistogramDataPoint {
  cost: number;
  count: number;
}

export function useHistogramData(spans: Span[]): DurationHistogramDataPoint[] {
  return useMemo(() => {
    const bins: { [key: number]: number } = {};
    
    spans.forEach(span => {
      // Only include root spans in duration histogram
      if (isRootSpan(span)) {
        const duration = getDurationMs(span);
        if (duration !== null) {
          const bin = Math.floor(duration / 1000) * 1000; // 1 second bins
          bins[bin] = (bins[bin] || 0) + 1;
        }
      }
    });

    return Object.entries(bins)
      .map(([bin, count]) => ({ duration: parseInt(bin), count }))
      .sort((a, b) => a.duration - b.duration);
  }, [spans]);
}

export function useTokensHistogramData(spans: Span[]): TokensHistogramDataPoint[] {
  return useMemo(() => {
    const traceTrees = organizeSpansByTraceId(spans);
    const bins: { [key: number]: number } = {};
    
    traceTrees.forEach((trees) => {
      let traceTokensTotal = 0;
      for (const tree of trees) {
        traceTokensTotal += calculateTokensForTree(tree);
      }
      
      if (traceTokensTotal > 0) {
        // Bin by thousands of tokens
        const bin = Math.floor(traceTokensTotal / 1000) * 1000;
        bins[bin] = (bins[bin] || 0) + 1;
      }
    });

    return Object.entries(bins)
      .map(([bin, count]) => ({ tokens: parseInt(bin), count }))
      .sort((a, b) => a.tokens - b.tokens);
  }, [spans]);
}

export function useCostHistogramData(spans: Span[]): CostHistogramDataPoint[] {
  return useMemo(() => {
    const traceTrees = organizeSpansByTraceId(spans);
    const bins: { [key: number]: number } = {};
    
    traceTrees.forEach((trees) => {
      let traceCostTotal = 0;
      for (const tree of trees) {
        traceCostTotal += calculateCostForTree(tree);
      }
      
      if (traceCostTotal > 0) {
        // Bin by 0.001 USD
        const bin = Math.floor(traceCostTotal / 0.001) * 0.001;
        bins[bin] = (bins[bin] || 0) + 1;
      }
    });

    return Object.entries(bins)
      .map(([bin, count]) => ({ cost: parseFloat(bin), count }))
      .sort((a, b) => a.cost - b.cost);
  }, [spans]);
}

export function useTimeseriesData(
  spans: Span[],
  feedbackMap: Map<string, FeedbackInfo>
): TimeseriesDataPoint[] {
  return useMemo(() => {
    return spans
      .filter(span => isRootSpan(span)) // Only include root spans for duration
      .map(span => {
        const startTime = getStartTime(span);
        const duration = getDurationMs(span);
        const tokens = getTotalTokenCount(span);
        const cost = getCost(span);
        const traceId = getTraceId(span);
        const feedback = traceId ? feedbackMap.get(traceId) : null;

        if (!startTime || duration === null) return null;

        return {
          time: startTime.getTime(),
          duration,
          tokens: tokens || 0,
          cost: cost || 0,
          feedback: feedback?.type === 'positive' ? 1 : feedback?.type === 'negative' ? -1 : 0,
        };
      })
      .filter((d): d is TimeseriesDataPoint => d !== null)
      .sort((a, b) => a.time - b.time);
  }, [spans, feedbackMap]);
}

export interface TokensTimeseriesDataPoint {
  time: number;
  tokens: number;
}

export interface CostTimeseriesDataPoint {
  time: number;
  cost: number;
}

export function useTokensTimeseriesData(
  spans: Span[],
  feedbackMap: Map<string, FeedbackInfo>
): TokensTimeseriesDataPoint[] {
  return useMemo(() => {
    const traceTrees = organizeSpansByTraceId(spans);
    const dataPoints: TokensTimeseriesDataPoint[] = [];

    traceTrees.forEach((trees, traceId) => {
      // Get the earliest start time from root spans in this trace
      let earliestTime: Date | null = null;
      for (const tree of trees) {
        const startTime = getStartTime(tree.span);
        if (startTime && (!earliestTime || startTime < earliestTime)) {
          earliestTime = startTime;
        }
      }

      if (earliestTime) {
        // Calculate total tokens for this trace (without double-counting)
        let traceTokensTotal = 0;
        for (const tree of trees) {
          traceTokensTotal += calculateTokensForTree(tree);
        }

        if (traceTokensTotal > 0) {
          dataPoints.push({
            time: earliestTime.getTime(),
            tokens: traceTokensTotal,
          });
        }
      }
    });

    return dataPoints.sort((a, b) => a.time - b.time);
  }, [spans, feedbackMap]);
}

export function useCostTimeseriesData(
  spans: Span[],
  feedbackMap: Map<string, FeedbackInfo>
): CostTimeseriesDataPoint[] {
  return useMemo(() => {
    const traceTrees = organizeSpansByTraceId(spans);
    const dataPoints: CostTimeseriesDataPoint[] = [];

    traceTrees.forEach((trees, traceId) => {
      // Get the earliest start time from root spans in this trace
      let earliestTime: Date | null = null;
      for (const tree of trees) {
        const startTime = getStartTime(tree.span);
        if (startTime && (!earliestTime || startTime < earliestTime)) {
          earliestTime = startTime;
        }
      }

      if (earliestTime) {
        // Calculate total cost for this trace (without double-counting)
        let traceCostTotal = 0;
        for (const tree of trees) {
          traceCostTotal += calculateCostForTree(tree);
        }

        if (traceCostTotal > 0) {
          dataPoints.push({
            time: earliestTime.getTime(),
            cost: traceCostTotal,
          });
        }
      }
    });

    return dataPoints.sort((a, b) => a.time - b.time);
  }, [spans, feedbackMap]);
}

