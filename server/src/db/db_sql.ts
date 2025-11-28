/**
 * PostgreSQL database operations and CRUD functions for metadata entities.
 * 
 * Lifecycle: Call initPool() before any operations, closePool() during shutdown.
 * All functions throw if pool not initialized. Most get/update/delete functions return null if entity not found.
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import {
	Organisation,
	User,
	ApiKey,
	Model,
	Dataset,
	Experiment,
} from '../common/types/index.js';
import SearchQuery from '../common/SearchQuery.js';
import { loadSchema, generatePostgresTable } from '../common/utils/schema-loader.js';
import { searchQueryToSqlWhereClause } from './sql_query.js';

let pool: Pool | null = null;

/** Allowed fields per table (excluding id, created, updated which are managed by the database)  */
const TABLE_FIELDS: Record<string, Set<string>> = {
	organisations: new Set(['name', 'rate_limit_per_hour', 'retention_period_days', 'members']),
	users: new Set(['email', 'name', 'sub']),
	api_keys: new Set(['organisation_id', 'rate_limit_per_hour', 'retention_period_days']),
	datasets: new Set(['organisation_id', 'name', 'description', 'tags', 'input_schema', 'output_schema', 'metrics']),
	experiments: new Set(['dataset_id', 'organisation_id', 'summary_results']),
	models: new Set(['organisation_id', 'name', 'api_key', 'version', 'description']),
};

/**
 * Filter item to only include allowed fields for the given table.
 */
function filterFields(tableName: string, item: Record<string, any>): Record<string, any> {
	const allowedFields = TABLE_FIELDS[tableName];
	if (!allowedFields) {
		throw new Error(`Unknown table: ${tableName}`);
	}

	const filtered: Record<string, any> = {};
	for (const [key, value] of Object.entries(item)) {
		if (allowedFields.has(key)) {
			filtered[key] = value;
		}
	}
	return filtered;
}

/**
 * Initialize connection pool. Must be called before any database operations.
 * Uses connectionString if provided, otherwise falls back to PGHOST/PGDATABASE/etc env vars.
 */
export function initPool(connectionString?: string): void {
	const poolConfig = {
		max: 20,
		idleTimeoutMillis: 30000,
		connectionTimeoutMillis: 10000, // Increased from 2000ms to 10000ms (10 seconds)
	};

	if (connectionString) {
		pool = new Pool({
			connectionString,
			...poolConfig,
		});
	} else {
		// Use environment variables (PGHOST, PGDATABASE, PGUSER, PGPASSWORD, etc.)
		pool = new Pool({
			host: process.env.PGHOST,
			database: process.env.PGDATABASE,
			user: process.env.PGUSER,
			password: process.env.PGPASSWORD,
			ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
			...poolConfig,
		});
	}

	// Handle pool errors gracefully
	pool.on('error', (err) => {
		console.error('Unexpected error on idle database client', err);
	});

	// Handle connection errors
	pool.on('connect', (client) => {
		client.on('error', (err) => {
			console.error('Database client error', err);
		});
	});
}

/**
 * Get a direct client from the pool for transactions. Caller must release with client.release().
 */
export async function getClient(): Promise<PoolClient> {
	if (!pool) {
		throw new Error('Database pool not initialized. Call initPool() first.');
	}
	return pool.connect();
}

export async function query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
	if (!pool) {
		throw new Error('Database pool not initialized. Call initPool() first.');
	}
	try {
		return await pool.query<T>(text, params);
	} catch (error) {
		// Re-throw with more context for connection errors
		if (error instanceof Error && error.message.includes('Connection terminated')) {
			throw new Error(`Database connection error: ${error.message}. Please check database connectivity.`);
		}
		throw error;
	}
}

/**
 * Create all database tables and indexes. Safe to call multiple times (uses IF NOT EXISTS).
 * Call during application startup.
 */
export async function createSchema(): Promise<void> {
	// Load schemas
	const organisationSchema = loadSchema('Organisation');
	const userSchema = loadSchema('User');
	const apiKeySchema = loadSchema('ApiKey');
	const modelSchema = loadSchema('Model');
	const datasetSchema = loadSchema('Dataset');
	const experimentSchema = loadSchema('Experiment');

	// Create organisations table
	await query(generatePostgresTable('Organisation', organisationSchema, {}, []));

	// Create users table
	await query(generatePostgresTable('User', userSchema, {}, []));

	// Create api_keys table
	await query(generatePostgresTable('ApiKey', apiKeySchema, {
		organisation_id: 'UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE'
	}, []));

	// Create models table
	await query(generatePostgresTable('Model', modelSchema, {
		organisation_id: 'UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE'
	}, []));

	// Create datasets table
	await query(generatePostgresTable('Dataset', datasetSchema, {
		organisation_id: 'UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE'
	}, [
		'UNIQUE(organisation_id, name)'
	]));

	// Create experiments table
	await query(generatePostgresTable('Experiment', experimentSchema, {
		dataset_id: 'UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE',
		organisation_id: 'UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE'
	}, []));

	// Create indexes
	await query(`CREATE INDEX IF NOT EXISTS idx_api_keys_organisation_id ON api_keys(organisation_id)`);
	await query(`CREATE INDEX IF NOT EXISTS idx_models_organisation_id ON models(organisation_id)`);
	await query(`CREATE INDEX IF NOT EXISTS idx_datasets_organisation_id ON datasets(organisation_id)`);
	await query(`CREATE INDEX IF NOT EXISTS idx_experiments_dataset_id ON experiments(dataset_id)`);
	await query(`CREATE INDEX IF NOT EXISTS idx_experiments_organisation_id ON experiments(organisation_id)`);

	// Add sub column to users table if it doesn't exist (migration)
	await query(`
    DO $$ 
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'sub'
      ) THEN
        ALTER TABLE users ADD COLUMN sub VARCHAR(255);
        CREATE INDEX IF NOT EXISTS idx_users_sub ON users(sub);
      END IF;
    END $$;
  `);
}

/**
 * Close the connection pool and release all connections. Call during graceful shutdown.
 */
export async function closePool(): Promise<void> {
	if (pool) {
		await pool.end();
		pool = null;
	}
}

// Generic CRUD helper functions
async function getById<T extends QueryResultRow>(
	tableName: string,
	id: string,
	transform?: (row: any) => T
): Promise<T | null> {
	const result = await query<T>(`SELECT * FROM ${tableName} WHERE id = $1`, [id]);
	if (!result.rows[0]) return null;
	return transform ? transform(result.rows[0]) : result.rows[0];
}

async function listEntities<T extends QueryResultRow>(
	tableName: string,
	organisationId: string | undefined,
	searchQuery: SearchQuery | string | null | undefined,
	transform?: (row: any) => T
): Promise<T[]> {
	let whereClause = searchQueryToSqlWhereClause(searchQuery);
	const params: any[] = [];

	if (organisationId) {
		whereClause += ` AND organisation_id = $1`;
		params.push(organisationId);
	}

	const sql = `SELECT * FROM ${tableName} WHERE ${whereClause} ORDER BY created DESC`;
	const result = await query<T>(sql, params.length > 0 ? params : undefined);
	return transform ? result.rows.map(transform) : result.rows;
}

async function createEntity<T extends QueryResultRow>(
	tableName: string,
	item: Record<string, any>,
	transform?: (row: any) => T
): Promise<T> {
	const filteredItem = filterFields(tableName, item);
	const fields = Object.keys(filteredItem);
	let values = fields.map(field => filteredItem[field]);
	// convert Object values to JSON strings for storage
	values = values.map(value => typeof value === 'object' ? JSON.stringify(value) : value);
	const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
	const result = await query<T>(
		`INSERT INTO ${tableName} (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`,
		values
	);
	return transform ? transform(result.rows[0]) : result.rows[0];
}

async function updateEntity<T extends QueryResultRow>(
	tableName: string,
	id: string,
	item: Record<string, any>,
	transform?: (row: any) => T
): Promise<T | null> {
	const filteredItem = filterFields(tableName, item);
	const fields = Object.keys(filteredItem);
	if (fields.length === 0) {
		return getById<T>(tableName, id, transform);
	}

	let values = fields.map(field => filteredItem[field]);
	// convert Object values to JSON strings for storage
	values = values.map(value => typeof value === 'object' ? JSON.stringify(value) : value);

	const setClause = fields.map((field, i) => `${field} = $${i + 1}`).join(', ');
	const idParam = `$${fields.length + 1}`;
	const result = await query<T>(
		`UPDATE ${tableName} SET ${setClause}, updated = NOW() WHERE id = ${idParam} RETURNING *`,
		[...values, id]
	);
	if (!result.rows[0]) return null;
	return transform ? transform(result.rows[0]) : result.rows[0];
}

async function deleteEntity(tableName: string, id: string): Promise<boolean> {
	const result = await query(`DELETE FROM ${tableName} WHERE id = $1`, [id]);
	return (result.rowCount ?? 0) > 0;
}


// Helper function to transform Organisation (no transformation needed, column names match interface)
function transformOrganisation(row: any): Organisation {
	return row as Organisation;
}

// CRUD operations for Organisation
export async function createOrganisation(org: Omit<Organisation, 'id' | 'created' | 'updated'>): Promise<Organisation> {
	return createEntity<Organisation>(
		'organisations', org,
		transformOrganisation
	);
}

export async function getOrganisation(id: string): Promise<Organisation | null> {
	return getById<Organisation>('organisations', id, transformOrganisation);
}

/**
 * @param searchQuery - Gmail-style search query (e.g. "name:acme") or SearchQuery instance. Returns all if null.
 */
export async function listOrganisations(searchQuery?: SearchQuery | string | null): Promise<Organisation[]> {
	return listEntities<Organisation>('organisations', undefined, searchQuery, transformOrganisation);
}

export async function updateOrganisation(id: string, updatedItem: Partial<Organisation>): Promise<Organisation | null> {
	return updateEntity<Organisation>('organisations', id, updatedItem, transformOrganisation);
}

/**
 * Returns true if deleted, false if not found. Cascades to related ApiKeys, Models, Datasets, Experiments.
 */
export async function deleteOrganisation(id: string): Promise<boolean> {
	return deleteEntity('organisations', id);
}

// CRUD operations for User
export async function createUser(user: Omit<User, 'id' | 'created' | 'updated'>): Promise<User> {
	return createEntity<User>(
		'users', user
	);
}

export async function getUser(id: string): Promise<User | null> {
	return getById<User>('users', id);
}

/**
 * @param searchQuery - Gmail-style search query or SearchQuery instance. Returns all if null.
 */
export async function listUsers(searchQuery?: SearchQuery | string | null): Promise<User[]> {
	return listEntities<User>('users', undefined, searchQuery);
}

export async function updateUser(id: string, updates: Partial<User>): Promise<User | null> {
	const item: Record<string, any> = {};

	if (updates.email !== undefined) item.email = updates.email;
	if (updates.name !== undefined) item.name = updates.name;

	return updateEntity<User>('users', id, item);
}

export async function deleteUser(id: string): Promise<boolean> {
	return deleteEntity('users', id);
}

// Helper function to transform ApiKey (no transformation needed, column names match interface)
function transformApiKey(row: any): ApiKey {
	return row as ApiKey;
}

// CRUD operations for ApiKey

/**
 */
export async function createApiKey(apiKey: Omit<ApiKey, 'id' | 'created' | 'updated'>): Promise<ApiKey> {
	return createEntity<ApiKey>(
		'api_keys',
		apiKey,
		transformApiKey
	);
}

export async function getApiKey(id: string): Promise<ApiKey | null> {
	return getById<ApiKey>('api_keys', id, transformApiKey);
}

/**
 * @param organisationId - Organisation ID (required)
 * @param searchQuery - Gmail-style search query or SearchQuery instance. Returns all if null.
 */
export async function listApiKeys(organisationId: string, searchQuery?: SearchQuery | string | null): Promise<ApiKey[]> {
	return listEntities<ApiKey>('api_keys', organisationId, searchQuery, transformApiKey);
}

export async function updateApiKey(id: string, updates: Partial<ApiKey>): Promise<ApiKey | null> {
	const item: Record<string, any> = {};

	if (updates.rate_limit_per_hour !== undefined) item.rate_limit_per_hour = updates.rate_limit_per_hour;
	if (updates.retention_period_days !== undefined) item.retention_period_days = updates.retention_period_days;

	return updateEntity<ApiKey>('api_keys', id, item, transformApiKey);
}

export async function deleteApiKey(id: string): Promise<boolean> {
	return deleteEntity('api_keys', id);
}

// Organisation Member operations

/**
 * @throws Error if organisation not found
 */
export async function addOrganisationMember(organisationId: string, userId: string): Promise<Organisation> {
	const org = await getOrganisation(organisationId);
	if (!org) {
		throw new Error('Organisation not found');
	}

	const members = org.members || [];
	if (!members.includes(userId)) {
		members.push(userId);
		const updated = await updateOrganisation(organisationId, { members });
		if (!updated) {
			throw new Error('Failed to update organisation');
		}
		return updated;
	}

	return org;
}

/**
 * Returns true if member was removed, false if organisation not found or user wasn't a member.
 */
export async function removeOrganisationMember(organisationId: string, userId: string): Promise<boolean> {
	const org = await getOrganisation(organisationId);
	if (!org) {
		return false;
	}

	const members = (org.members || []).filter(id => id !== userId);
	const updated = await updateOrganisation(organisationId, { members });
	return updated !== null && members.length < (org.members || []).length;
}

/**
 * Returns empty array if organisation not found or has no members.
 */
export async function getOrganisationMembers(organisationId: string): Promise<User[]> {
	const org = await getOrganisation(organisationId);
	if (!org || !org.members || org.members.length === 0) {
		return [];
	}

	const result = await query<User>(
		`SELECT * FROM users WHERE id = ANY($1)`,
		[org.members]
	);
	return result.rows;
}

/**
 * Find all organisations that a user belongs to (where user ID is in members array).
 * Returns empty array if user is not a member of any organisation.
 */
export async function getOrganisationsForUser(userId: string): Promise<Organisation[]> {
	const result = await query<Organisation>(
		`SELECT * FROM organisations WHERE $1 = ANY(members)`,
		[userId]
	);
	return result.rows.map(transformOrganisation);
}

// Helper function to transform Dataset JSON fields
function transformDataset(row: any): Dataset {
	return {
		...row,
		input_schema: row.input_schema ? (typeof row.input_schema === 'string' ? JSON.parse(row.input_schema) : row.input_schema) : undefined,
		output_schema: row.output_schema ? (typeof row.output_schema === 'string' ? JSON.parse(row.output_schema) : row.output_schema) : undefined,
		metrics: row.metrics ? (typeof row.metrics === 'string' ? JSON.parse(row.metrics) : row.metrics) : undefined,
	};
}

// CRUD operations for Dataset

/**
 * JSON fields (input_schema, output_schema, metrics) are automatically serialized.
 */
export async function createDataset(dataset: Omit<Dataset, 'id' | 'created' | 'updated'>): Promise<Dataset> {
	return createEntity<Dataset>(
		'datasets',
		dataset,
		transformDataset
	);
}

/**
 * JSON fields are automatically parsed.
 */
export async function getDataset(id: string): Promise<Dataset | null> {
	return getById<Dataset>('datasets', id, transformDataset);
}

/**
 * @param organisationId - Organisation ID (required)
 * @param searchQuery - Gmail-style search query or SearchQuery instance. Returns all if null.
 */
export async function listDatasets(organisationId: string, searchQuery?: SearchQuery | string | null): Promise<Dataset[]> {
	return listEntities<Dataset>('datasets', organisationId, searchQuery, transformDataset);
}

/**
 * JSON fields are automatically serialized.
 */
export async function updateDataset(id: string, updates: Partial<Dataset>): Promise<Dataset | null> {
	return updateEntity<Dataset>('datasets', id, updates, transformDataset);
}

/**
 * Returns true if deleted, false if not found. Cascades to related Experiments.
 */
export async function deleteDataset(id: string): Promise<boolean> {
	return deleteEntity('datasets', id);
}

// Helper function to transform Experiment JSON fields
function transformExperiment(row: any): Experiment {
	return {
		...row,
		summary_results: typeof row.summary_results === 'string' ? JSON.parse(row.summary_results) : row.summary_results,
	};
}

// CRUD operations for Experiment

/**
 * summary_results JSON field is automatically serialized.
 */
export async function createExperiment(experiment: Omit<Experiment, 'id' | 'created' | 'updated'>): Promise<Experiment> {
	return createEntity<Experiment>(
		'experiments',
		experiment,
		transformExperiment
	);
}

/**
 * summary_results JSON field is automatically parsed.
 */
export async function getExperiment(id: string): Promise<Experiment | null> {
	return getById<Experiment>('experiments', id, transformExperiment);
}

/**
 * @param organisationId - Organisation ID (required)
 * @param searchQuery - Gmail-style search query or SearchQuery instance. Returns all if null.
 */
export async function listExperiments(organisationId: string, searchQuery?: SearchQuery | string | null): Promise<Experiment[]> {
	return listEntities<Experiment>('experiments', organisationId, searchQuery, transformExperiment);
}

/**
 * summary_results JSON field is automatically serialized.
 */
export async function updateExperiment(id: string, updates: Partial<Experiment>): Promise<Experiment | null> {
	const item: Record<string, any> = {};

	if (updates.summary_results !== undefined) item.summary_results = JSON.stringify(updates.summary_results);

	return updateEntity<Experiment>('experiments', id, item, transformExperiment);
}

export async function deleteExperiment(id: string): Promise<boolean> {
	return deleteEntity('experiments', id);
}

// CRUD operations for Model
export async function createModel(model: Omit<Model, 'id' | 'created' | 'updated'>): Promise<Model> {
	return createEntity<Model>(
		'models',
		model
	);
}

export async function getModel(id: string): Promise<Model | null> {
	return getById<Model>('models', id);
}

/**
 * @param organisationId - Organisation ID (required)
 * @param searchQuery - Gmail-style search query or SearchQuery instance. Returns all if null.
 */
export async function listModels(organisationId: string, searchQuery?: SearchQuery | string | null): Promise<Model[]> {
	return listEntities<Model>('models', organisationId, searchQuery);
}

export async function updateModel(id: string, updates: Partial<Model>): Promise<Model | null> {
	return updateEntity<Model>('models', id, updates);
}

export async function deleteModel(id: string): Promise<boolean> {
	return deleteEntity('models', id);
}

