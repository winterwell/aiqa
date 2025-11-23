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

Package manager: pnpm

Receives opentelemetry traces from a client and stores them in an ElasticSearch database.
Also uses a Postgre SQL database for storing metadata about the organisation and users.

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
 - /input Copies of spans for a given dataset. Have fields for organisation id, dataset id, (ElasticSearch)
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
