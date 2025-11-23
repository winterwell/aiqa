import { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { ExportResult, ExportResultCode } from '@opentelemetry/core';

interface SerializableSpan {
  name: string;
  kind: number;
  parentSpanId?: string;
  startTime: [number, number];
  endTime: [number, number];
  status: {
    code: number;
    message?: string;
  };
  attributes: Record<string, any>;
  links: Array<{
    context: {
      traceId: string;
      spanId: string;
    };
    attributes?: Record<string, any>;
  }>;
  events: Array<{
    name: string;
    time: [number, number];
    attributes?: Record<string, any>;
  }>;
  resource: {
    attributes: Record<string, any>;
  };
  traceId: string;
  spanId: string;
  traceFlags: number;
  duration: [number, number];
  ended: boolean;
  instrumentationLibrary: {
    name: string;
    version?: string;
  };
}

export class AiqaSpanExporter implements SpanExporter {
  private serverUrl: string;
  private apiKey: string;
  private flushIntervalMs: number;
  private buffer: SerializableSpan[] = [];
  private flushTimer?: NodeJS.Timeout;
  private flushLock: Promise<void> = Promise.resolve();
  private shutdownRequested: boolean = false;

  constructor(
    serverUrl: string = 'http://localhost:3000',
    apiKey: string,
    flushIntervalSeconds: number = 5
  ) {
    this.serverUrl = serverUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = apiKey;
    this.flushIntervalMs = flushIntervalSeconds * 1000;
    this.startAutoFlush();
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (spans.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    // Call callback immediately to avoid timeout
    resultCallback({ code: ExportResultCode.SUCCESS });
    
    // Add spans to buffer (thread-safe)
    this.addToBuffer(spans);
  }

  /**
   * Add spans to the buffer in a thread-safe manner
   */
  private addToBuffer(spans: ReadableSpan[]): void {
    const serializedSpans = spans.map(span => this.serializeSpan(span));
    this.buffer.push(...serializedSpans);
  }

  /**
   * Convert ReadableSpan to a serializable format
   */
  private serializeSpan(span: ReadableSpan): SerializableSpan {
    const spanContext = span.spanContext();
    return {
      name: span.name,
      kind: span.kind,
      parentSpanId: span.parentSpanId,
      startTime: span.startTime,
      endTime: span.endTime,
      status: {
        code: span.status.code,
        message: span.status.message,
      },
      attributes: span.attributes,
      links: span.links.map(link => ({
        context: {
          traceId: link.context.traceId,
          spanId: link.context.spanId,
        },
        attributes: link.attributes,
      })),
      events: span.events.map(event => ({
        name: event.name,
        time: event.time,
        attributes: event.attributes,
      })),
      resource: {
        attributes: span.resource.attributes,
      },
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      traceFlags: spanContext.traceFlags,
      duration: span.duration,
      ended: span.ended,
      instrumentationLibrary: span.instrumentationLibrary,
    };
  }

  /**
   * Flush buffered spans to the server
   * Thread-safe: ensures only one flush operation runs at a time
   */
  async flush(): Promise<void> {
    // Wait for any ongoing flush to complete
    await this.flushLock;

    // Create a new lock for this flush operation
    let resolveFlush: () => void;
    this.flushLock = new Promise(resolve => {
      resolveFlush = resolve;
    });

    try {
      // Get current buffer and clear it atomically
      const spansToFlush = this.buffer.splice(0);

      if (spansToFlush.length === 0) {
        return;
      }

      await this.sendSpans(spansToFlush);
    } catch (error: any) {
      console.error('Error flushing spans to server:', error.message);
      throw error;
    } finally {
      resolveFlush!();
    }
  }

  /**
   * Send spans to the server API
   */
  private async sendSpans(spans: SerializableSpan[]): Promise<void> {
    const response = await fetch(`${this.serverUrl}/span`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(spans),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to send spans: ${response.status} ${response.statusText} - ${errorText}`);
    }
  }

  /**
   * Start the auto-flush timer
   */
  private startAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      if (!this.shutdownRequested) {
        this.flush().catch((error: any) => {
          console.error('Error in auto-flush:', error.message);
        });
      }
    }, this.flushIntervalMs);
  }

  /**
   * Shutdown the exporter, flushing any remaining spans
   */
  async shutdown(): Promise<void> {
    this.shutdownRequested = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }

    // Flush any remaining spans
    await this.flush();
  }
}

// Compatibility export alias for ElasticsearchSpanExporter
// Note: This is a compatibility layer - the actual implementation uses AiqaSpanExporter
// which requires AIQA_SERVER_URL and AIQA_API_KEY environment variables
export class ElasticsearchSpanExporter extends AiqaSpanExporter {
  constructor(serverUrl: string = 'http://localhost:9200', index: string = 'traces') {
    // Map ELASTICSEARCH_BASE_URL to AIQA server URL, or use AIQA_SERVER_URL if set
    const aiqaServerUrl = process.env.AIQA_SERVER_URL || serverUrl;
    const apiKey = process.env.AIQA_API_KEY || '';
    if (!apiKey) {
      console.warn('Warning: AIQA_API_KEY not set. Spans may not be sent successfully.');
    }
    super(aiqaServerUrl, apiKey);
  }
}

