/**
 * gRPC server for OTLP/gRPC (Protobuf) support.
 * Implements the OpenTelemetry TraceService.
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';
import { processOtlpTraceExport } from './routes/spans.js';
import { parseOtlpProtobuf } from './utils/otlp_protobuf.js';
import { authenticateFromGrpcMetadata, AuthenticatedRequest, checkAccess } from './server_auth.js';

let grpcServer: grpc.Server | null = null;

/**
 * Get the OTLP proto package definition.
 * Uses proto files from opentelemetry-proto/ directory.
 */
function getOtlpProtoPackage(): protoLoader.PackageDefinition {
  // Proto files are in opentelemetry-proto/ directory relative to server root
  const protoDir = join(process.cwd(), 'opentelemetry-proto');
  const protoPath = join(protoDir, 'opentelemetry/proto/collector/trace/v1/trace_service.proto');
  
  try {
    // Load from opentelemetry-proto directory. Use camelCase + numeric enums so request shape matches HTTP/Protobuf path.
    return protoLoader.loadSync(protoPath, {
      keepCase: false,
      longs: String,
      enums: Number,
      defaults: true,
      oneofs: true,
      includeDirs: [protoDir],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `OTLP proto files not found at ${protoPath}. ` +
      `Please ensure opentelemetry-proto directory exists with proto files. ` +
      `Original error: ${message}`
    );
  }
}

/**
 * Handle ExportTraceServiceRequest from gRPC client.
 */
async function handleExport(
  call: grpc.ServerUnaryCall<any, any>,
  callback: grpc.sendUnaryData<any>
): Promise<void> {
  try {
    // Extract authentication from gRPC metadata
    const metadata = call.metadata;
    const authHeader = metadata.get('authorization')[0] as string || metadata.get('Authorization')[0] as string || '';
    
    const authRequest = {
      headers: {
        authorization: authHeader,
      },
    } as AuthenticatedRequest;
    
    // Authenticate the request
    try {
      await authenticateFromGrpcMetadata(authRequest);
    } catch (authError: any) {
      callback({
        code: grpc.status.UNAUTHENTICATED,
        message: authError.message || 'Authentication failed',
      });
      return;
    }
    
    const organisation = authRequest.organisation;
    
    if (!organisation) {
      callback({
        code: grpc.status.UNAUTHENTICATED,
        message: 'Authentication required',
      });
      return;
    }
    
    // Check access (trace, developer, or admin role required)
    // Create a mock reply object for checkAccess
    const mockReply = {
      code: (code: number) => mockReply,
      send: (data: any) => {},
      sent: false,
    } as any;
    
    if (!checkAccess(authRequest, mockReply, ['trace', 'developer', 'admin'])) {
      callback({
        code: grpc.status.PERMISSION_DENIED,
        message: 'Insufficient permissions',
      });
      return;
    }
    
    const request = call.request;
    // Proto-loader with keepCase: false, enums: Number yields camelCase + numeric enums (same shape as HTTP/Protobuf).
    const otlpRequest = Buffer.isBuffer(request)
      ? parseOtlpProtobuf(request)
      : request;
    
    // Process the OTLP trace export (rate limiting, storage, etc.)
    const result = await processOtlpTraceExport(otlpRequest, organisation);
    
    if (!result.success && result.error) {
      // Map error code to gRPC status
      const grpcCode = result.error.code === 14 ? grpc.status.RESOURCE_EXHAUSTED : grpc.status.INVALID_ARGUMENT;
      callback({
        code: grpcCode,
        message: result.error.message,
      });
      return;
    }
    
    // Return success response (empty ExportTraceServiceResponse)
    callback(null, {});
    
  } catch (error: any) {
    // Handle connection errors (e.g., Elasticsearch unavailable)
    if (error.name === 'ConnectionError' || error.message?.includes('ConnectionError')) {
      callback({
        code: grpc.status.UNAVAILABLE,
        message: 'Elasticsearch service unavailable',
      });
      return;
    }
    
    // Bad data or other error
    callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: error.message || 'Invalid request data',
    });
  }
}

/**
 * Start the gRPC server for OTLP/gRPC (Protobuf) support.
 * Default port: 4317 (OTLP standard for gRPC)
 * 
 * Note: This implementation requires OTLP proto files in the proto/ directory.
 * To include them, clone https://github.com/open-telemetry/opentelemetry-proto
 * and place the opentelemetry/proto directory in aiqa/server/proto/
 * 
 * @returns Object with server and port (port is the actual bound port, which may differ from input if port was 0)
 */
export async function startGrpcServer(port: number = 4317): Promise<{ server: grpc.Server; port: number }> {
  if (grpcServer) {
    // Return existing server and get port from bindings
    const bindings = (grpcServer as any).bindings || [];
    const existingPort = bindings.length > 0 ? parseInt(bindings[0].split(':')[1] || '4317') : port;
    return { server: grpcServer, port: existingPort };
  }

  try {
    const packageDefinition = getOtlpProtoPackage();
    const traceServiceProto = grpc.loadPackageDefinition(packageDefinition) as any;
    
    // Get the service definition
    const serviceDef = traceServiceProto.opentelemetry?.proto?.collector?.trace?.v1?.TraceService?.service;
    
    if (!serviceDef) {
      throw new Error('TraceService not found in proto definition. Please ensure OTLP proto files are available in proto/ directory.');
    }
    
    const server = new grpc.Server();
    
    // Register the TraceService
    server.addService(serviceDef, {
      Export: handleExport,
    });
    
    // Start server - bind to 0.0.0.0 to allow external connections (not just localhost)
    return new Promise((resolve, reject) => {
      server.bindAsync(
        `0.0.0.0:${port}`,
        grpc.ServerCredentials.createInsecure(),
        (error, actualPort) => {
          if (error) {
            reject(error);
            return;
          }
          server.start();
          console.log(`gRPC server listening on port ${actualPort}`);
          grpcServer = server;
          resolve({ server, port: actualPort });
        }
      );
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to start gRPC server: ${message}`);
  }
}

/** Max wait for graceful shutdown before forcing (avoids hang when clients don't close). */
const SHUTDOWN_GRACE_MS = 2000;

/**
 * Stop the gRPC server.
 * Uses tryShutdown first; if it doesn't complete within SHUTDOWN_GRACE_MS (e.g. clients left open),
 * forceShutdown is used so the process can exit.
 */
export async function stopGrpcServer(): Promise<void> {
  if (!grpcServer) return;
  const server = grpcServer;
  grpcServer = null;
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    server.tryShutdown((error) => {
      if (error) {
        server.forceShutdown();
      }
      done();
    });
    setTimeout(() => {
      server.forceShutdown();
      done();
    }, SHUTDOWN_GRACE_MS);
  });
}

