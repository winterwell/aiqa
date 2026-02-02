import { ReadableSpan } from '@opentelemetry/sdk-trace-base';

/**
 * Span type extending OpenTelemetry's ReadableSpan interface.
 * Represents a completed span that can be read and exported.
 */
export default interface Span extends Omit<ReadableSpan, 'startTime' | 'endTime' | 'parentSpanId'> {
  /** Span ID (OpenTelemetry span ID as hex string) */
  id: string;
  /** Trace ID */
  trace: string;
  /** Parent span ID */
  parent?: string;
  organisation: string;
  /** Example.id Only set if (a) an Example is created from this Span, or (b) this Span is created during an experiment running an Example */
  example?: string;
  /** Only set for spans in the `spans` index IF created during an experiment */
  experiment?: string;
  /** Client-set annotations for the span (for things more complex than a tag) */
  annotations?: Record<string, any>;
  /** Client-set tags for the span */
  tags?: string[];
  /** Hash of the input for looking up same-input spans */
  inputHash?: string;
  /** Start time in epoch milliseconds (overrides ReadableSpan's HrTime format) */
  start: number;
  /** End time in epoch milliseconds (overrides ReadableSpan's HrTime format) */
  end: number;
  /** For loaded parents only: child span-id hashes already incorporated into token/cost (avoids losing counts when only late-arriving spans in batch) */
  _seen?: number[];
}

export function getSpanInput(span: Span) {
  return span.attributes?.input;
}
export function getSpanOutput(span: Span) {
  return span.attributes?.output;
}

// Utility functions for fields with non-standard names (to modularise that logic and keep it in one place)
/** Span ID. Use our id field only (which is different from the OpenTelemetry spanId field). */
export const getSpanId = (span: Span): string | undefined => (span as any)?.id;

/** Trace ID. Use our trace field only (which is different from the OpenTelemetry traceId field). */
export const getTraceId = (span: Span): string | undefined => (span as any)?.trace;

/** Parent span ID. Use our parent field only (which is different from the OpenTelemetry parentSpanId field). */
export const getParentSpanId = (span: Span): string | null => span.parent ?? null;

