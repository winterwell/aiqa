import { ReadableSpan } from '@opentelemetry/sdk-trace-base';

/**
 * Span type extending OpenTelemetry's ReadableSpan interface.
 * Represents a completed span that can be read and exported.
 */
export interface Span extends ReadableSpan {
	/** Trace ID */
	traceId: string;
  organisation: string;  
  /** Only set for spans in the `dataset_spans` index */
  dataset?: string | string[];
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
}

