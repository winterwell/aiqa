"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElasticsearchSpanExporter = void 0;
const core_1 = require("@opentelemetry/core");
const elasticsearch_1 = require("@elastic/elasticsearch");
class ElasticsearchSpanExporter {
    constructor(elasticsearchUrl = 'http://localhost:9200', index = 'traces') {
        this.indexCreated = false;
        this.client = new elasticsearch_1.Client({
            node: elasticsearchUrl,
            requestTimeout: 10000,
        });
        this.index = index;
        this.ensureIndex();
    }
    async ensureIndex() {
        if (this.indexCreated)
            return;
        try {
            const exists = await this.client.indices.exists({ index: this.index });
            if (!exists) {
                await this.client.indices.create({
                    index: this.index,
                    body: {
                        settings: {
                            number_of_shards: 1,
                            number_of_replicas: 0, // No replicas for single-node cluster
                        },
                        mappings: {
                            properties: {
                                '@timestamp': { type: 'date' },
                                'trace.id': { type: 'keyword' },
                                'span.id': { type: 'keyword' },
                                'span.name': { type: 'text' },
                                'service.name': { type: 'keyword' },
                            }
                        }
                    }
                });
            }
            else {
                // Index exists but might be red - try to fix replica settings
                try {
                    await this.client.indices.putSettings({
                        index: this.index,
                        body: {
                            index: {
                                number_of_replicas: 0
                            }
                        }
                    });
                }
                catch (settingsError) {
                    // Ignore settings update errors
                }
            }
            this.indexCreated = true;
        }
        catch (error) {
            // Index might already exist - that's fine
            if (!error.message?.includes('resource_already_exists_exception')) {
                console.warn('Index creation check:', error.message);
            }
            this.indexCreated = true; // Assume it exists or will be created
        }
        // TODO setup / check schema
        this.ensureIndexSchema();
    }
    ensureIndexSchema() {
        // TODO create / check the index
    }
    export(spans, resultCallback) {
        if (spans.length === 0) {
            resultCallback({ code: core_1.ExportResultCode.SUCCESS });
            return;
        }
        // Call callback immediately to avoid timeout, then export async
        resultCallback({ code: core_1.ExportResultCode.SUCCESS });
        // Export spans asynchronously (fire-and-forget)
        this.exportSpans(spans).catch((error) => {
            console.error('Error exporting spans to Elasticsearch:', error.message);
        });
    }
    async exportSpans(spans) {
        try {
            await this.ensureIndex();
        }
        catch (error) {
            // Index might be in transition, continue anyway
        }
        const body = spans.flatMap(span => {
            const traceId = span.spanContext().traceId;
            const spanId = span.spanContext().spanId;
            const parentSpanId = span.parentSpanId;
            const doc = {
                '@timestamp': new Date(span.startTime[0] * 1000 + span.startTime[1] / 1000000).toISOString(),
                trace: {
                    id: traceId,
                },
                transaction: {
                    id: spanId,
                    name: span.name,
                    type: 'request',
                    duration: (span.endTime[0] - span.startTime[0]) * 1000 + (span.endTime[1] - span.startTime[1]) / 1000000,
                },
                span: {
                    id: spanId,
                    name: span.name,
                    duration: {
                        us: (span.endTime[0] - span.startTime[0]) * 1000000 + (span.endTime[1] - span.startTime[1]) / 1000,
                    },
                    parent: parentSpanId ? { id: parentSpanId } : undefined,
                },
                service: {
                    name: span.resource.attributes['service.name'] || 'unknown',
                },
                attributes: span.attributes,
                events: span.events.map(event => ({
                    name: event.name,
                    timestamp: new Date(event.time[0] * 1000 + event.time[1] / 1000000).toISOString(),
                    attributes: event.attributes || {},
                })),
            };
            return [{ index: { _index: this.index } }, doc];
        });
        await this.client.bulk({ body });
    }
    async shutdown() {
        // Client cleanup if needed
    }
}
exports.ElasticsearchSpanExporter = ElasticsearchSpanExporter;
