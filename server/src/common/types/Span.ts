import { ReadableSpan } from '@opentelemetry/sdk-trace-base';

/**
 * Span type extending OpenTelemetry's ReadableSpan interface.
 * Represents a completed span that can be read and exported.
 */
export interface Span extends ReadableSpan {
  organisation_id: string;  
  /** Only set for spans in the `dataset_spans` index */
  dataset_id?: string | string[];
  /** Only set for spans in the `spans` index IF created during an experiment */
  experiment_id?: string;
  /** Client-set span ID (overrides OpenTelemetry span ID if provided) */
  client_span_id?: string;
  /** Client-set trace ID (overrides OpenTelemetry trace ID if provided) */
  client_trace_id?: string;
  /** Client-set tags for the span */
  tags?: Record<string, any>;
  /** Hash of the input for looking up same-input spans */
  input_hash?: string;
}

