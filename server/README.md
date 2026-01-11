An API server which:

Language: typescript
Fastify framework
Database:
 - ElasticSearch
 - PostgreSQL

Unit tests: tap

Run scripts:
npm run dev (watches for changes and recompiles)
npm run build (compiles the code)
npm run test (runs the tests)
npm run start (starts the server)

Installation:
After cloning or pulling changes, run: pnpm install
This installs dependencies including @fastify/compress for HTTP response compression.

Package manager: pnpm

Receives opentelemetry traces from a client and stores them in an ElasticSearch database.
Also uses a Postgre SQL database for storing metadata about the organisation and users.
Uses Redis for rate limiting span posting per organisation.

This will be a public API, acting as a thin wrapper around the ElasticSearch database.

Multi-tenant:
 - Database tables for Organisation, User, and API Key
    - API Key is used to authenticate logging requests
 - API key and Organisation have a rate-limit parameter and a retention period (how long to keep spans)
 - Organisation has members, users who can access it
 - logging requests use an API Key. This looks up the organisation id -- which is stored as a field in the span

RESTful Endpoints:
 - /span (ElasticSearch). Supports bulk insert.
 - /organisation (PostgreSQL)
 - /user (PostgreSQL)
 - /api-key (PostgreSQL)
 - /dataset (PostgreSQL) name, organisation id. Optional fields for description, tags, input-schema, output-schema, metrics.
 - /example Examples for a given dataset. Have fields for organisation id, dataset id, and either spans array or inputs field (ElasticSearch)
 - /experiment (PostgreSQL) - summary results of running a dataset.
	spans have an optional experiment id field, so we can surface details by experiment.

Query / List requests use:
 - gmail style search syntax -- see SearchQuery.ts

db_sql.ts 
db_es.ts
functions which handle database schema creation, the database connections and queries.
Write reusable code and avoid repeating code.
Keep types to the minimum wanted (e.g. one type per database table/index). 
Local utility types are fine for e.g. complex function input parameters. But avoid defining similar types, or types which are very simple.
Except for local utility types, type definitions should be in a Types.ts file in the types directory.

## Types / Schema files
Types are mostly auto-generated from the TypeScript code.
The Span type is maintained manually.
scripts/generate-schemas.js is used to generate the schema files.

## Redis Setup (Rate Limiting)

The server uses Redis for rate limiting span posting per organisation. Rate limits are configured per organisation via the `rate_limit_per_hour` field (defaults to 1000 if not set).

### Installation

**macOS (Homebrew):**
```bash
brew install redis
brew services start redis
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get update
sudo apt-get install redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

**Docker:**
```bash
docker run -d -p 6379:6379 redis:latest
```

### Configuration

Set the `REDIS_URL` environment variable in your `.env` file:
```
REDIS_URL=redis://localhost:6379
```

For remote Redis or authentication:
```
REDIS_URL=redis://username:password@host:port
```

### Behavior

- Rate limiting uses a sliding window approach (last hour)
- If Redis is unavailable, rate limiting is disabled (fail-open behavior)
- Rate limit is checked before processing spans
- Returns HTTP 429 (Too Many Requests) when limit is exceeded
- Response includes `limit`, `remaining`, and `resetAt` fields

### Testing Redis Connection

You can test your Redis connection:
```bash
redis-cli ping
# Should return: PONG
```

## Span Retention

The server supports automatic deletion of old spans based on organisation retention periods. Each organisation can set a `retention_period_days` field (defaults to 20 days if not set).

### Running the Retention Script

The retention script deletes spans older than the retention period for each organisation. Spans are deleted based on their `endTime` (or `startTime` if `endTime` is missing).

**Manual execution:**
```bash
pnpm run retention
```

**Automated execution via crontab:**

Add to your crontab (e.g., run daily at 2 AM):
```bash
crontab -e
```

Add this line:
```
0 2 * * * cd /path/to/aiqa/server && /usr/bin/node dist/scripts/delete-old-spans.js >> /var/log/aiqa-retention.log 2>&1
```

Or if using pnpm:
```
0 2 * * * cd /path/to/aiqa/server && pnpm run retention >> /var/log/aiqa-retention.log 2>&1
```

**Note:** Make sure the script has access to the same environment variables (`.env` file or system environment) as the main server, including `DATABASE_URL` (or `PGHOST`/`PGDATABASE`/etc) and `ELASTICSEARCH_URL`.

### How It Works

1. Connects to PostgreSQL to fetch all organisations
2. For each organisation, uses `retention_period_days` (default: 20 days)
3. Deletes spans in Elasticsearch where:
   - The span belongs to the organisation
   - The span's `endTime` (or `startTime` if `endTime` is missing) is older than the retention period
4. Logs the number of spans deleted per organisation