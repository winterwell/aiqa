import { ReadableSpan } from '@opentelemetry/sdk-trace-base';

/**
 * Span type extending OpenTelemetry's ReadableSpan interface.
 * Represents a completed span that can be read and exported.
 */
export default interface Span extends Omit<ReadableSpan, 'startTime' | 'endTime' | 'parentSpanId'> {
	/** Span ID (OpenTelemetry span ID as hex string) */
	id: string;
	/** Trace ID */
	trace_id: string;
  /** Parent span ID */
  parent_span_id?: string;
  organisation: string;
  /** Example.id Only set if (a) an Example is created from this Span, or (b) this Span is created during an experiment running an Example */
  example?: string;
  /** Only set for spans in the `spans` index IF created during an experiment */
  experiment?: string;
  /** Client-set span ID (goes alongside OpenTelemetry span ID if provided) */
  client_span_id?: string;
  /** Client-set trace ID (goes alongside OpenTelemetry trace ID if provided) */
  client_trace_id?: string;
  /** Client-set tags for the span */
  tags?: string[];
  /** Hash of the input for looking up same-input spans */
  input_hash?: string;
  /** If true, the span is starred by a user */
  starred: boolean;
  /** Start time in epoch milliseconds (overrides ReadableSpan's HrTime format) */
  start_time: number;
  /** End time in epoch milliseconds (overrides ReadableSpan's HrTime format) */
  end_time: number;
  /** For loaded parents only: child span-id hashes already incorporated into token/cost (avoids losing counts when only late-arriving spans in batch) */
  _seen?: number[];
}

export function getSpanInput(span:Span) {
	return span.attributes?.input;
}
export function getSpanOutput(span:Span) {
	return span.attributes?.output;
}


export const getSpanId = (span: Span) => {
    // Check id first (standard), then spanId (legacy fallback), then OpenTelemetry spanContext() method
    if (!span) return undefined;
    return (span as any)?.id || (span as any)?.spanId || (span.spanContext && typeof span.spanContext === 'function' ? span.spanContext()?.spanId : undefined);
  };

  export  const getTraceId = (span: Span) => {
    // Check direct trace_id property first, then OpenTelemetry spanContext() method
    if (!span) return undefined;
    return span.trace_id || (span.spanContext && typeof span.spanContext === 'function' ? span.spanContext()?.traceId : undefined);
  };

  export  const getStartTime = (span: Span) => {
    if (!span.start_time) return null;
    return new Date(span.start_time);
  };

  /**
   * 
   * @param span 
   * @returns milliseconds or null
   */
  export const getDuration = (span: Span) => {
    if (!span.start_time || !span.end_time) return null;
    return span.end_time - span.start_time;
  };

