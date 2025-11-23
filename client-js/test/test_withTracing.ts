import * as dotenv from 'dotenv';
import * as path from 'path';
import { withTracing } from '../src/tracing';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { ElasticsearchSpanExporter } from '../src/aiqa-exporter';

// Load environment variables from .env file in project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Initialize OpenTelemetry with Elasticsearch exporter
// Note: The exporter uses AIQA_SERVER_URL and AIQA_API_KEY env vars for actual server connection
const aiqaServerUrl = process.env.AIQA_SERVER_URL;
const index = process.env.ELASTICSEARCH_INDEX || 'traces';
const exporter = new ElasticsearchSpanExporter(aiqaServerUrl, index);

const provider = new NodeTracerProvider({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: 'test-service',
  }),
});

provider.addSpanProcessor(new BatchSpanProcessor(exporter));
provider.register();

/**
 * Basic test for withTracing()
 */
async function testWithTracing() {
  console.log('Starting test for withTracing()...');
  console.log('Server URL:', aiqaServerUrl);
  console.log('Index:', index);
  console.log('AIQA_API_KEY:', process.env.AIQA_API_KEY ? '***set***' : 'NOT SET');
  
  if (!process.env.AIQA_API_KEY) {
    console.warn('Warning: AIQA_API_KEY environment variable is not set. Spans may not be sent successfully.');
  }

  // Test 1: Simple function with no arguments
  const noArgFn = () => {
    return 'test-result';
  };
  const tracedNoArg = withTracing(noArgFn, { name: 'testNoArg' });
  const result1 = tracedNoArg();
  console.log('Test 1 - No args result:', result1);
  if (result1 !== 'test-result') {
    throw new Error('Test 1 failed: incorrect return value');
  }

  // Test 2: Function with single argument
  const singleArgFn = (x: number) => {
    return x * 2;
  };
  const tracedSingleArg = withTracing(singleArgFn, { name: 'testSingleArg' });
  const result2 = tracedSingleArg(5);
  console.log('Test 2 - Single arg result:', result2);
  if (result2 !== 10) {
    throw new Error('Test 2 failed: incorrect return value');
  }

  // Test 3: Function with multiple arguments
  const multiArgFn = (a: number, b: string) => {
    return `${a}-${b}`;
  };
  const tracedMultiArg = withTracing(multiArgFn, { name: 'testMultiArg' });
  const result3 = tracedMultiArg(42, 'hello');
  console.log('Test 3 - Multi arg result:', result3);
  if (result3 !== '42-hello') {
    throw new Error('Test 3 failed: incorrect return value');
  }

  // Test 4: Function that throws an error
  const errorFn = () => {
    throw new Error('Test error');
  };
  const tracedError = withTracing(errorFn, { name: 'testError' });
  try {
    tracedError();
    throw new Error('Test 4 failed: should have thrown an error');
  } catch (error: any) {
    if (error.message !== 'Test error') {
      throw new Error('Test 4 failed: incorrect error message');
    }
    console.log('Test 4 - Error handling: OK');
  }

  // Test 5: Function with custom name
  const customNameFn = () => 'custom';
  const tracedCustom = withTracing(customNameFn, { name: 'customTraceName' });
  const result5 = tracedCustom();
  console.log('Test 5 - Custom name result:', result5);
  if (result5 !== 'custom') {
    throw new Error('Test 5 failed: incorrect return value');
  }

  // Flush spans before shutdown
  try {
    await provider.forceFlush();
    console.log('\n✓ All tests passed! Traces sent successfully to server.');
  } catch (flushError: any) {
    console.error('\n⚠ Error flushing traces:', flushError.message || flushError);
    if (flushError.stack) console.error(flushError.stack);
    throw flushError;
  }

  // Shutdown
  try {
    await provider.shutdown();
    console.log('\nTracer shutdown complete.');
  } catch (shutdownError: any) {
    console.error('Error during shutdown:', shutdownError.message);
    throw shutdownError;
  }
}

// Run the test
testWithTracing().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});

