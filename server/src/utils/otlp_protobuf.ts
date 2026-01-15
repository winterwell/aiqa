/**
 * Utilities for parsing OTLP Protobuf messages.
 * Supports both HTTP/Protobuf and gRPC/Protobuf formats.
 * 
 * Uses the actual OTLP proto files from opentelemetry-proto repository.
 */

import protobuf from 'protobufjs';
import { join, resolve, dirname } from 'path';

let root: protobuf.Root | null = null;

/**
 * Get or create the OTLP protobuf root by loading the actual proto files.
 * Proto files are loaded from opentelemetry-proto/ directory.
 */
function getOtlpProtoRoot(): protobuf.Root {
  if (root) {
    return root;
  }

  // Load proto files from opentelemetry-proto directory
  const protoDir = join(process.cwd(), 'opentelemetry-proto');
  const opentelemetryProtoDir = join(protoDir, 'opentelemetry/proto');
  const traceServiceProto = join(opentelemetryProtoDir, 'collector/trace/v1/trace_service.proto');
  
  try {
    // Create a new Root and set the resolvePath function to handle imports correctly
    root = new protobuf.Root();
    
    // Override resolvePath to resolve imports from the opentelemetry/proto directory
    root.resolvePath = (origin: string, target: string): string => {
      // If the import starts with 'opentelemetry/proto/', resolve from opentelemetryProtoDir
      if (target.startsWith('opentelemetry/proto/')) {
        const relativePath = target.replace('opentelemetry/proto/', '');
        return join(opentelemetryProtoDir, relativePath);
      }
      // Otherwise, resolve relative to the origin file
      return resolve(dirname(origin), target);
    };
    
    // Load the trace service proto file (it will automatically load dependencies via imports)
    root.loadSync(traceServiceProto);
    
    // Resolve all types to ensure everything is loaded
    root.resolveAll();
    
    // Verify the main type exists
    const ExportTraceServiceRequest = root.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');
    if (!ExportTraceServiceRequest) {
      throw new Error('ExportTraceServiceRequest type not found after loading proto files');
    }
    
    return root;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to load OTLP proto files from ${traceServiceProto}. ` +
      `Ensure opentelemetry-proto directory exists with proto files. ` +
      `Original error: ${message}`
    );
  }
}

/**
 * Parse OTLP Protobuf binary data to JSON format compatible with existing code.
 * The output format matches what convertOtlpSpansToInternal expects (JSON with base64-encoded bytes).
 */
export function parseOtlpProtobuf(buffer: Buffer): any {
  const protoRoot = getOtlpProtoRoot();
  const ExportTraceServiceRequest = protoRoot.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');
  
  if (!ExportTraceServiceRequest) {
    throw new Error('ExportTraceServiceRequest type not found');
  }
  
  // Decode the protobuf message
  let message: protobuf.Message;
  try {
    message = ExportTraceServiceRequest.decode(buffer);
  } catch (error) {
    throw new Error(`Failed to decode protobuf message: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // Convert to plain JavaScript object
  // Per OTLP spec, enums should be integers (not strings), bytes as base64 strings
  const json = ExportTraceServiceRequest.toObject(message, {
    longs: String,
    enums: Number, // Use numeric enum values per OTLP JSON spec
    bytes: String, // Convert bytes to base64 strings to match JSON format
    defaults: true,
    arrays: true,
    objects: true,
    oneofs: true
  });
  
  return json;
}
