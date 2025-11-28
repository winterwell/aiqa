/**
 * OpenTelemetry tracing setup and utilities. Initializes tracer provider on import.
 * Provides withTracingAsync and withTracing decorators to automatically trace function calls.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { ATTR_CODE_FUNCTION_NAME, SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { AIQASpanExporter } from './aiqa-exporter';

// Load environment variables from .env file in client-js directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Initialize OpenTelemetry with Elasticsearch exporter
const aiqaServerUrl = process.env.AIQA_SERVER_URL;
const exporter = new AIQASpanExporter(aiqaServerUrl);

const provider = new NodeTracerProvider({
	resource: new Resource({
		[SEMRESATTRS_SERVICE_NAME]: 'example-service',
	}),
});

provider.addSpanProcessor(new BatchSpanProcessor(exporter));

provider.register();

// Getting a tracer with the same name ('example-tracer') simply returns a tracer instance;
// it does NOT link spans automatically within the same trace.
// Each time you start a new root span (span without a parent), a new trace-id is generated.
// Spans only share a trace-id if they are started as children of the same trace context.

const tracer = trace.getTracer('example-tracer');

/**
 * Flush all pending spans to the server.
 * Flushes also happen automatically every few seconds. So you only need to call this function 
 * if you want to flush immediately, e.g. before exiting a process.
 * 
 * This flushes both the BatchSpanProcessor and the exporter buffer.
 * 
 */
export async function flushSpans(): Promise<void> {
	await provider.forceFlush();
	await exporter.flush();
}

/**
 * Shutdown the tracer provider and exporter. 
 * It is not necessary to call this function.
 */
export async function shutdownTracing(): Promise<void> {
	await provider.shutdown();
	await exporter.shutdown();
}

// Export provider and exporter for advanced usage
export { provider, exporter };

/**
 * Options for withTracing and withTracingAsync functions
 */
export interface TracingOptions {
	name?: string;
	ignoreInput?: any;
	ignoreOutput?: any;
	filterInput?: (input: any) => any;
	filterOutput?: (output: any) => any;
}

/**
 * Wrap async function to automatically create spans. Records input/output as span attributes.
 * Spans are automatically linked via OpenTelemetry context.
 */
export function withTracingAsync(fn: Function, options: TracingOptions = {}) {
	const { name, ignoreInput, ignoreOutput, filterInput, filterOutput } = options;
	let fnName = name || fn.name || "_";
	if ((fn as any)._isTraced) {
		console.warn('Function ' + fnName + ' is already traced, skipping tracing again');
		return fn;
	}
	const tracedFn = async (...args: any[]) => {
		const span = tracer.startSpan(fnName);
		// Trace inputs using input. attributes
		let input = args;
		if (args.length === 0) {
			input = null;
		} else if (args.length === 1) {
			input = args[0];
		}
		if (filterInput) {
			input = filterInput(input);
		}
		if (ignoreInput && typeof input === 'object') {
			// TODO make a copy of input removing fields in ignoreInput
		}
		if (input != null) {
			span.setAttribute('input', input);
		}
		try {
			// call the function
			const traceId = span.spanContext().traceId;
			console.log('do traceable stuff', { fnName, traceId });
			const curriedFn = () => fn(...args)
			const result = await context.with(trace.setSpan(context.active(), span), curriedFn);
			// Trace output
			let output = result;
			if (filterOutput) {
				output = filterOutput(output);
			}
			if (ignoreOutput && typeof output === 'object') {
				// TODO make a copy of output removing fields in ignoreOutput
			}
			span.setAttribute('output', output);

			return result;
		} catch (exception) {
			const error = exception instanceof Error ? exception : new Error(String(exception));
			span.recordException(error);
			span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
			throw error; // Re-throw to maintain error propagation		  
		} finally {
			span.end();
		}
	};
	tracedFn._isTraced = true; // avoid double wrapping
	console.log('Function ' + fnName + ' is now traced');
	return tracedFn;
}


/**
 * Wrap synchronous function to automatically create spans. Records input/output as span attributes.
 * Spans are automatically linked via OpenTelemetry context.
 */
export function withTracing(fn: Function, options: TracingOptions = {}) {	
	const { name, ignoreInput, ignoreOutput, filterInput, filterOutput } = options;
	let fnName = name || fn.name || "_";
	if ((fn as any)._isTraced) {
		console.warn('Function ' + fnName + ' is already traced, skipping tracing again');
		return fn;
	}
	const tracedFn = (...args: any[]) => {
		const span = tracer.startSpan(fnName);
		// Trace inputs using input. attributes
		let input = args;
		if (args.length === 0) {
			input = null;
		} else if (args.length === 1) {
			input = args[0];
		}
		if (filterInput) {
			input = filterInput(input);
		}
		if (ignoreInput && typeof input === 'object') {
			// TODO make a copy of input removing fields in ignoreInput
		}
		if (input != null) {
			span.setAttribute('input', input);
		}
		try {
			// call the function
			const traceId = span.spanContext().traceId;
			console.log('do traceable stuff', { fnName, traceId });
			const curriedFn = () => fn(...args)
			const result = context.with(trace.setSpan(context.active(), span), curriedFn);
			// Trace output
			let output = result;
			if (filterOutput) {
				output = filterOutput(output);
			}
			if (ignoreOutput && typeof output === 'object') {
				// TODO make a copy of output removing fields in ignoreOutput
			}
			span.setAttribute('output', output);

			return result;
		} catch (exception) {
			const error = exception instanceof Error ? exception : new Error(String(exception));
			span.recordException(error);
			span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
			throw error; // Re-throw to maintain error propagation		  
		} finally {
			span.end();
		}
	};
	tracedFn._isTraced = true; // avoid double wrapping
	console.log('Function ' + fnName + ' is now traced');
	return tracedFn;
}



export function setSpanAttribute(attributeName: string, attributeValue: any) {
	let span = trace.getActiveSpan();
	if (span) {
		span.setAttribute(attributeName, attributeValue);
		return true
	}
	return false; // no span found
}

export function getActiveSpan() {
	return trace.getActiveSpan();
}
