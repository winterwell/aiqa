import { getOtlpProtoRoot } from '../dist/utils/otlp_protobuf.js';

/**
 * Encode OTLP ExportTraceServiceRequest from JSON (same shape as parseOtlpProtobuf output) to protobuf binary.
 * Bytes in JSON should be base64 strings; they are converted to Buffer for encoding.
 */
export function encodeOtlpProtobuf(json: any): Buffer {
  const protoRoot = getOtlpProtoRoot();
  const ExportTraceServiceRequest = protoRoot.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');
  if (!ExportTraceServiceRequest) {
    throw new Error('ExportTraceServiceRequest type not found');
  }
  // Convert base64 byte fields back to Buffer for encoding
  const protoRequest = {
    resourceSpans: (json.resourceSpans || []).map((rs: any) => ({
      resource: rs.resource,
      scopeSpans: (rs.scopeSpans || []).map((ss: any) => ({
        scope: ss.scope,
        spans: (ss.spans || []).map((s: any) => ({
          ...s,
          traceId: typeof s.traceId === 'string' ? Buffer.from(s.traceId, 'base64') : s.traceId,
          spanId: typeof s.spanId === 'string' ? Buffer.from(s.spanId, 'base64') : s.spanId,
          parentSpanId: s.parentSpanId && typeof s.parentSpanId === 'string' ? Buffer.from(s.parentSpanId, 'base64') : s.parentSpanId,
        })),
      })),
    })),
  };
  const message = ExportTraceServiceRequest.create(protoRequest);
  const buffer = ExportTraceServiceRequest.encode(message).finish();
  return Buffer.from(buffer);
}