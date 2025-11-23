"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
const api_1 = require("@opentelemetry/api");
const sdk_trace_node_1 = require("@opentelemetry/sdk-trace-node");
const sdk_trace_base_1 = require("@opentelemetry/sdk-trace-base");
const resources_1 = require("@opentelemetry/resources");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const elasticsearch_exporter_1 = require("./elasticsearch-exporter");
// Load environment variables from .env file in project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
// Initialize OpenTelemetry with Elasticsearch exporter
const elasticsearchUrl = process.env.ELASTICSEARCH_BASE_URL || 'http://localhost:9200';
const index = process.env.ELASTICSEARCH_INDEX || 'traces';
const exporter = new elasticsearch_exporter_1.ElasticsearchSpanExporter(elasticsearchUrl, index);
const provider = new sdk_trace_node_1.NodeTracerProvider({
    resource: new resources_1.Resource({
        [semantic_conventions_1.SEMRESATTRS_SERVICE_NAME]: 'example-service',
    }),
});
provider.addSpanProcessor(new sdk_trace_base_1.BatchSpanProcessor(exporter));
provider.register();
// Getting a tracer with the same name ('example-tracer') simply returns a tracer instance;
// it does NOT link spans automatically within the same trace.
// Each time you start a new root span (span without a parent), a new trace-id is generated.
// Spans only share a trace-id if they are started as children of the same trace context.
const tracer = api_1.trace.getTracer('example-tracer');
// Example:
// const span1 = tracer.startSpan('operation');
// const span2 = tracer.startSpan('operation'); // Both are root spans, each has its own trace-id.
//
// If you want two spans to share a trace-id, you must start one as a child (using context):
// const parentSpan = tracer.startSpan('parent');
// context.with(trace.setSpan(context.active(), parentSpan), () => {
//   const childSpan = tracer.startSpan('child'); // childSpan.traceId === parentSpan.traceId
// });
//
// To summarize:
// - Getting a tracer with the same name does NOT guarantee spans are in the same trace.
// - A new trace-id is created each time you start a new root span (span without an active parent).
async function testTraceable(optionalArg) {
    const span = tracer.startSpan('testTraceable');
    const traceId = span.spanContext().traceId;
    console.log('do traceable parent stuff', { traceId });
    await api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
        await subSpanFunction(optionalArg || "arg-A", { "key-B": 17 });
    });
    span.end();
    return traceId;
}
async function subSpanFunction(argA, argB) {
    const span = tracer.startSpan('subSpanFunction');
    // Trace inputs as span attributes
    span.setAttribute('function.input.argA', argA);
    span.setAttribute('function.input.argB', JSON.stringify(argB));
    try {
        if (argA && ("" + argA).includes("fail")) {
            throw new Error("Intentional Test Error");
        }
        console.log('do traceable sub-span stuff', {
            traceId: span.spanContext().traceId,
            spanId: span.spanContext().spanId
        });
        // Simulate some work
        await new Promise(resolve => setTimeout(resolve, 100));
        const result = JSON.stringify(["OUTPUT ECHO:", argA, argB]);
        // Trace return value as span attribute
        span.setAttribute('function.output.result', result);
        return result;
    }
    catch (exception) {
        const error = exception instanceof Error ? exception : new Error(String(exception));
        span.recordException(error);
        span.setStatus({ code: api_1.SpanStatusCode.ERROR, message: error.message });
        throw error; // Re-throw to maintain error propagation
    }
    finally {
        span.end();
    }
}
async function main() {
    console.log('Starting trace example...');
    console.log('Elasticsearch URL:', elasticsearchUrl);
    console.log('Index:', index);
    let traceId;
    let traceId2;
    try {
        traceId = await testTraceable();
        try {
            traceId2 = await testTraceable("nope");
        }
        catch (exception) {
            console.log('swallow Error:', exception);
        }
        // Flush spans before shutdown
        try {
            await provider.forceFlush();
            console.log('\n✓ Trace sent successfully to Elasticsearch!');
        }
        catch (flushError) {
            console.error('\n⚠ Error flushing traces:', flushError.message || flushError);
            if (flushError.stack)
                console.error(flushError.stack);
        }
        console.log('\nTo retrieve the trace from Elasticsearch:');
        console.log(`  curl -X GET "${elasticsearchUrl}/${index}/_search?q=trace.id:${traceId}"`);
        console.log(`  Or use Kibana: http://localhost:5601/app/discover#/?_a=(index:'${index}')&_q=(query:(match:(trace.id:'${traceId}')))`);
    }
    catch (error) {
        console.error('Error:', error);
    }
    finally {
        // Shutdown
        try {
            await provider.shutdown();
            console.log('\nTracer shutdown complete.');
        }
        catch (shutdownError) {
            console.error('Error during shutdown:', shutdownError.message);
        }
    }
}
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
