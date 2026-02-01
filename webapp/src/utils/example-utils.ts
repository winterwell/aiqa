import type { Example, Span } from '../common/types';
import { getTraceId as getSpanTraceId } from './span-utils';
import { SPECIFIC_METRIC } from '../common/defaultSystemMetrics';

/**
 * Get the first span from an Example, or return the example itself if it has span-like fields.
 */
export function getFirstSpan(example: Example): Span | null {
  if (example.spans && example.spans.length > 0) {
    return example.spans[0] as Span;
  }
  // If no spans array, check if example itself has span-like fields (for backward compatibility)
  if ((example as any).name || (example as any).spanId) {
    return example as any as Span;
  }
  return null;
}

/**
 * Get the trace ID from an Example.
 * Tries multiple fallback locations for trace ID.
 */
export function getExampleTraceId(example: Example): string | null {
  const span = getFirstSpan(example);
  if (span) {
    const traceId = getSpanTraceId(span);
    if (traceId) return traceId;
    // Fallback to other possible trace ID locations
    return (span as any).trace?.id || (span as any).client_trace_id || (span as any).traceId || example.traceId || null;
  }
  return example.traceId || null;
}

/**
 * Get the input value from an Example.
 * Priority: example.input > (if single span) span.attributes.input > example.spans
 */
export function getExampleInput(example: Example): any {
  if (example.input !== undefined && example.input !== null) {
    return example.input;
  }
  if (example.spans?.length === 1) {
    return example.spans[0]?.attributes?.input;
  }
  return example.spans;
}

/**
 * Get a string representation of the input, truncated to maxLength characters.
 * If input is a string, truncate it directly.
 * If input is an object, stringify it first, then truncate.
 */
export function getExampleInputString(input: any, maxLength: number = 100): string {
  if (input === undefined || input === null) {
    return '';
  }
  
  let str: string;
  if (typeof input === 'string') {
    str = input;
  } else {
    try {
      str = JSON.stringify(input);
    } catch {
      str = String(input);
    }
  }
  
  if (str.length <= maxLength) {
    return str;
  }
  
  return str.substring(0, maxLength) + '...';
}

/**
 * Get the text content from the "specific" metric in Example.metrics.
 * Returns the prompt (for LLM type) or code (for javascript type), or empty string if not found.
 */
export function getExampleSpecificMetricText(example: Example): string {
  return getExampleMetricDisplayText(example, SPECIFIC_METRIC.id);
}

/**
 * Get display text for a metric on an example by metric id.
 * Returns prompt (LLM), code (javascript), or empty string if not found.
 */
export function getExampleMetricDisplayText(example: Example, metricId: string): string {
  if (!example.metrics || !Array.isArray(example.metrics)) {
    return '';
  }
  const metric = example.metrics.find(m => m.id === metricId);
  if (!metric) return '';
  if (metric.type === 'llm' && metric.prompt) return metric.prompt;
  if (metric.type === 'javascript' && metric.code) return metric.code;
  return '';
}

