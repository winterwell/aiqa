import { ReadableSpan } from '@opentelemetry/sdk-trace-base';

/**
 * Span type extending OpenTelemetry's ReadableSpan interface.
 * Represents a completed span that can be read and exported.
 */
export default interface Span extends Omit<ReadableSpan, 'startTime' | 'endTime'> {
	/** Trace ID */
	traceId: string;
  organisation: string;
  /** Example.id Only set if (a) an Example is created from this Span, or (b) this Span is created during an experiment running an Example */
  example?: string;
  /** Only set for spans in the `spans` index IF created during an experiment */
  experiment?: string;
  /** Client-set span ID (goes alongside OpenTelemetry span ID if provided) */
  clientSpanId?: string;
  /** Client-set trace ID (goes alongside OpenTelemetry trace ID if provided) */
  clientTraceId?: string;
  /** Client-set tags for the span */
  tags?: string[];
  /** Hash of the input for looking up same-input spans */
  inputHash?: string;
  /** If true, the span is starred by a user */
  starred: boolean;
  /** Start time in epoch milliseconds (overrides ReadableSpan's HrTime format) */
  startTime: number;
  /** End time in epoch milliseconds (overrides ReadableSpan's HrTime format) */
  endTime: number;
}

export function getSpanInput(span:Span) {
	return span.attributes?.input;
}
export function getSpanOutput(span:Span) {
	return span.attributes?.output;
}


export const getSpanId = (span: Span) => {
    // Check direct properties first (as stored in ES), then OpenTelemetry spanContext() method
    if (!span) return undefined;
    return (span as any)?.spanId || (span as any)?.id || (span.spanContext && typeof span.spanContext === 'function' ? span.spanContext()?.spanId : undefined);
  };

  export  const getTraceId = (span: Span) => {
    // Check direct traceId property first, then OpenTelemetry spanContext() method
    if (!span) return undefined;
    return span.traceId || (span.spanContext && typeof span.spanContext === 'function' ? span.spanContext()?.traceId : undefined);
  };

  export  const getStartTime = (span: Span) => {
    if (!span.startTime) return null;
    return new Date(span.startTime);
  };

  /**
   * 
   * @param span 
   * @returns milliseconds or null
   */
  export const getDuration = (span: Span) => {
    if (!span.startTime || !span.endTime) return null;
    return span.endTime - span.startTime;
  };

