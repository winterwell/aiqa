# AIQA Repository Summary

**Purpose:** AIQA is an AI Quality Assurance platform for tracing, testing, and monitoring AI/LLM applications. It provides observability into AI systems via OpenTelemetry-compatible tracing, along with tools for running experiments and evaluating AI outputs.

**Mission:** Help people and companies make better, safer, and more reliable applied AI solutions.

## Architecture Overview

```
┌─────────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Client Libraries  │────▶│   AIQA Server    │────▶│  Databases      │
│   (JS/Python/Go/    │     │   (Fastify +     │     │  - Elasticsearch│
│    Java)            │     │    gRPC)         │     │  - PostgreSQL   │
└─────────────────────┘     └──────────────────┘     │  - Redis        │
                                    ▲                └─────────────────┘
                                    │
                            ┌───────┴───────┐
                            │  AIQA Webapp  │
                            │  (React/Vite) │
                            └───────────────┘
```

- **Storage:** Elasticsearch for spans/traces (time-series data), PostgreSQL for relational data (orgs, users, datasets, experiments)
- **Tracing:** OpenTelemetry-compatible via OTLP/HTTP (JSON + Protobuf) and OTLP/gRPC
- **Rate Limiting:** Redis-based sliding window rate limiting per organisation

## Main Components

### 1. Server (`/server`)
- **Language:** TypeScript
- **Framework:** Fastify (HTTP) + gRPC (for OTLP/Protobuf)
- **Port:** 4318 (HTTP), 4317 (gRPC)
- **Package Manager:** pnpm

Key directories:
- `src/routes/` - RESTful API endpoints
- `src/db/` - Database access (db_sql.ts for PostgreSQL, db_es.ts for Elasticsearch)
- `src/common/types/` - Shared type definitions
- `src/common/SearchQuery.ts` - Gmail-style search query parser

### 2. Webapp (`/webapp`)
- **Framework:** React + Vite
- **Auth:** Auth0
- **Dev Port:** 4000

Key pages: TracesListPage, TraceDetailsPage, ExperimentsListPage, ExperimentDetailsPage, DatasetListPage, DatasetDetailsPage, MetricsListPage, MetricDetailsPage

### 3. Website (`/website`)
- Static marketing/documentation site served via nginx

## Data Models

Core types defined in `server/src/common/types/`:

| Type | Storage | Description |
|------|---------|-------------|
| **Span** | Elasticsearch | OpenTelemetry-compatible trace span with AIQA extensions (organisation, tags, experiment, example) |
| **Organisation** | PostgreSQL | Multi-tenant organisation with members and rate limits |
| **User** | PostgreSQL | User accounts linked to Auth0 |
| **ApiKey** | PostgreSQL | API keys for authenticating trace logging |
| **Dataset** | PostgreSQL | Collection of examples for testing |
| **Example** | Elasticsearch | Test case with inputs/expected outputs, linked to dataset |
| **Experiment** | PostgreSQL | Results from running a dataset through an AI system |
| **Model** | PostgreSQL | LLM model configurations |
| **OrganisationAccount** | PostgreSQL | Subscription/billing info |

## API Endpoints

All endpoints use Gmail-style search syntax via `SearchQuery` for filtering.

| Endpoint | Storage | Description |
|----------|---------|-------------|
| `/span` | ES | Trace spans (bulk insert supported) |
| `/organisation` | PG | Organisations |
| `/user` | PG | Users |
| `/api-key` | PG | API keys |
| `/dataset` | PG | Datasets |
| `/example` | ES | Examples for datasets |
| `/experiment` | PG | Experiment results |
| `/model` | PG | Model configurations |
| `/v1/traces` | ES | OTLP-compatible trace endpoint |

## Key Features

1. **Multi-tenant:** Organisations with member management, rate limits, and retention periods
2. **OpenTelemetry Compatible:** Accepts OTLP/HTTP (JSON + Protobuf) and OTLP/gRPC traces
3. **Span Retention:** Automatic deletion of old spans based on org-configurable retention period
4. **Rate Limiting:** Per-organisation rate limits with Redis sliding window
5. **Experiments:** Run datasets through AI systems and track results
6. **Metrics/Scoring:** Evaluate AI outputs with configurable metrics

## Related Repositories (Client Libraries)

- **JavaScript/TypeScript:** https://github.com/winterwell/aiqa-client-js
- **Python:** https://github.com/winterwell/aiqa-client-python  
- **Go:** https://github.com/winterwell/aiqa-client-go
- **Java:** https://github.com/winterwell/aiqa-client-java

## Deployment

- **Production Webapp:** https://app-aiqa.winterwell.com
- **Production Website/API:** https://aiqa.winterwell.com
- **CI/CD:** GitHub Actions workflows for server and webapp deployment
- **Infrastructure:** Ubuntu server with nginx, systemd services

See `/deploy/DEPLOYMENT.md` for detailed deployment instructions.

## Key Configuration

- `server/.env` - Server environment variables (DATABASE_URL, ELASTICSEARCH_URL, AUTH0_*, REDIS_URL)
- `webapp/.env` - Webapp build variables (VITE_AIQA_SERVER_URL, VITE_AUTH0_*)

## Tech Stack Summary

| Component | Technology |
|-----------|------------|
| Server Runtime | Node.js + TypeScript |
| HTTP Framework | Fastify |
| gRPC | @grpc/grpc-js |
| Database (relational) | PostgreSQL |
| Database (traces) | Elasticsearch |
| Rate Limiting | Redis |
| Frontend | React + Vite |
| Auth | Auth0 (JWT) |
| Payments | Stripe |
| Testing | tap (Node.js) |
| Deployment | GitHub Actions + systemd + nginx |
