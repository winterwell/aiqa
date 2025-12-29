import { ReadableSpan } from '@opentelemetry/sdk-trace-base';

/**
 * Span type extending OpenTelemetry's ReadableSpan interface.
 * Represents a completed span that can be read and exported.
 */
export default interface Span extends ReadableSpan {
	/** Trace ID */
	traceId: string;
  organisation: string;
  /** Only set for spans in the `spans` index IF created during an experiment */
  experiment?: string;
  /** Client-set span ID (goes alongside OpenTelemetry span ID if provided) */
  clientSpanId?: string;
  /** Client-set trace ID (goes alongside OpenTelemetry trace ID if provided) */
  clientTraceId?: string;
  /** Client-set tags for the span */
  tags?: Record<string, any>;
  /** Hash of the input for looking up same-input spans */
  inputHash?: string;
  /** If true, the span is starred by a user */
  starred: boolean;
}

export function getSpanInput(span:Span) {
	return span.attributes?.input;
}
export function getSpanOutput(span:Span) {
	return span.attributes?.output;
}


export const getSpanId = (span: Span) => {
    return (span as any).span?.id || (span as any).client_span_id || 'N/A';
  };

  export  const getTraceId = (span: Span) => {
    return (span as any).trace?.id || (span as any).client_trace_id || 'N/A';
  };

  export  const getStartTime = (span: Span) => {
    if (!(span as any).startTime) return null;
    return new Date((span as any).startTime[0] * 1000 + (span as any).startTime[1] / 1000000);
  };

  export const getDuration = (span: Span) => {
    if (!(span as any).startTime || !(span as any).endTime) return null;
    const start = (span as any).startTime[0] * 1000 + (span as any).startTime[1] / 1000000;
    const end = (span as any).endTime[0] * 1000 + (span as any).endTime[1] / 1000000;
    return end - start;
  };

