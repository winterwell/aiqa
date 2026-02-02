import type { Example, Span } from '../common/types';
import { getTraceId } from '../common/types/Span.js';
import { SPECIFIC_METRIC } from '../common/defaultSystemMetrics';

/** Get the first span from an Example. Canonical shape only (fail-fast). */
export function getFirstSpan(example: Example): Span | null {
  if (example.spans && example.spans.length > 0) {
    return example.spans[0] as Span;
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
    const traceId = getTraceId(span);
    if (traceId) return traceId;
  }
  return example.trace ?? null;
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
  if (metric.type === 'llm') return metric.promptCriteria || metric.prompt || '';
  if (metric.type === 'javascript' && metric.code) return metric.code;
  return '';
}

