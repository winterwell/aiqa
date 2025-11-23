# OpenTelemetry based client - logs traces to the server

## Setup

1. Install dependencies:
```bash
npm install
```

2. Build TypeScript:
```bash
npm run build
```

## Running

Make sure Elasticsearch APM Server is running and accessible at `http://localhost:8200` (or set `OTEL_EXPORTER_OTLP_ENDPOINT`).

Run the example:
```bash
npm start
```

Or run directly with ts-node:
```bash
npm run dev
```

## Retrieving Traces

After running, traces are sent to Elasticsearch. To view them:

1. **Kibana UI**: Navigate to `http://localhost:5601/app/apm/traces`
2. **Elasticsearch API**: Query traces by traceId:
```bash
curl -X GET "localhost:9200/apm-*/_search?q=trace.id:<traceId>"
```

The traceId is printed in the console output when the example runs.

## Configuration

Set the OTLP endpoint via environment variable:
```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://your-elasticsearch:8200 npm start
```

