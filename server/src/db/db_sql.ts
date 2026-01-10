/**
 * PostgreSQL database operations and CRUD functions for metadata entities.
 * 
 * Lifecycle: Call initPool() before any operations, closePool() during shutdown.
 * All functions throw if pool not initialized. Most get/update/delete functions return null if entity not found.
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import {
	Organisation,
	OrganisationAccount,
	User,
	ApiKey,
	Model,
	Dataset,
	Experiment,
} from '../common/types/index.js';
import SearchQuery from '../common/SearchQuery.js';
import { loadSchema, generatePostgresTable, getTypeDefinition } from '../common/utils/schema-loader.js';
import { searchQueryToSqlWhereClause } from './sql_query.js';

let pool: Pool | null = null;

/** Allowed fields per table (excluding id, created, updated which are managed by the database)  */
const TABLE_FIELDS = {
	organisations: getAllowedFieldsFromSchema('Organisation'),
	organisation_accounts: getAllowedFieldsFromSchema('OrganisationAccount'),
	users: getAllowedFieldsFromSchema('User'),
	api_keys: getAllowedFieldsFromSchema('ApiKey'),
	datasets: getAllowedFieldsFromSchema('Dataset'),
	experiments: getAllowedFieldsFromSchema('Experiment'),
	models: getAllowedFieldsFromSchema('Model'),
};

	/** Use the schema-loader to fetch allowed fields for a given entity type. */
function getAllowedFieldsFromSchema(typeName: string): Set<string> {
	
	const schema = loadSchema(typeName);
	if (!schema || typeof schema !== 'object') {
		throw new Error(`Schema not found for type: ${typeName}`);
	}

	// Get the actual type definition from the schema
	const typeDef = getTypeDefinition(schema, typeName);
	if (!typeDef || !typeDef.properties) {
		throw new Error(`Could not find type definition for ${typeName}`);
	}

	// Accept property keys as allowed fields, except for 'id', 'created', 'updated' (managed by DB)
	const skip = new Set(['id', 'created', 'updated']);
	const allowed = Object.keys(typeDef.properties)
		.filter(key => !skip.has(key));
	return new Set(allowed);
}

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

export async function doQuery<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
	// console.log('doQuery', text, params);
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
export async function createTables(): Promise<void> {
	// Load schemas
	const organisationSchema = loadSchema('Organisation');
	const organisationAccountSchema = loadSchema('OrganisationAccount');
	const userSchema = loadSchema('User');
	const apiKeySchema = loadSchema('ApiKey');
	const modelSchema = loadSchema('Model');
	const datasetSchema = loadSchema('Dataset');
	const experimentSchema = loadSchema('Experiment');

	// Create organisations table
	await doQuery(generatePostgresTable('Organisation', organisationSchema, {}, []));

	// Create organisation_accounts table
	await doQuery(generatePostgresTable('OrganisationAccount', organisationAccountSchema, {
		organisation: 'UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE'
	}, [
		'UNIQUE(organisation)'
	]));

	// Create users table
	await doQuery(generatePostgresTable('User', userSchema, {}, []));

	// Create api_keys table
	await doQuery(generatePostgresTable('ApiKey', apiKeySchema, {
		organisation: 'UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE'
	}, []));

	// Create models table
	await doQuery(generatePostgresTable('Model', modelSchema, {
		organisation: 'UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE'
	}, []));

	// Create datasets table
	await doQuery(generatePostgresTable('Dataset', datasetSchema, {
		organisation: 'UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE'
	}, [
		'UNIQUE(organisation, name)'
	]));

	// Create experiments table
	await doQuery(generatePostgresTable('Experiment', experimentSchema, {
		dataset: 'UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE',
		organisation: 'UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE'
	}, []));

	// Create indexes
		await doQuery(`CREATE INDEX IF NOT EXISTS idx_api_keys_organisation ON api_keys(organisation)`);
	await doQuery(`CREATE INDEX IF NOT EXISTS idx_organisation_accounts_organisation ON organisation_accounts(organisation)`);
	await doQuery(`CREATE INDEX IF NOT EXISTS idx_models_organisation ON models(organisation)`);
	await doQuery(`CREATE INDEX IF NOT EXISTS idx_datasets_organisation ON datasets(organisation)`);
	await doQuery(`CREATE INDEX IF NOT EXISTS idx_experiments_dataset ON experiments(dataset)`);
	await doQuery(`CREATE INDEX IF NOT EXISTS idx_experiments_organisation ON experiments(organisation)`);

	await applyMigrations();
}


async function applyMigrations(): Promise<void> {
	// Add sub column to users table if it doesn't exist (migration)
	await doQuery(`
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
	
		// Allow NULL emails in users table (migration)
		await doQuery(`
		DO $$ 
		BEGIN
		  IF EXISTS (
			SELECT 1 FROM information_schema.columns 
			WHERE table_name = 'users' 
			AND column_name = 'email' 
			AND is_nullable = 'NO'
		  ) THEN
			ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
		  END IF;
		END $$;
	  `);
	
	// Add key_hash column to api_keys table if it doesn't exist (migration)
	await doQuery(`
		DO $$ 
		BEGIN
		  IF NOT EXISTS (
			SELECT 1 FROM information_schema.columns 
			WHERE table_name = 'api_keys' AND column_name = 'key_hash'
		  ) THEN
			ALTER TABLE api_keys ADD COLUMN key_hash VARCHAR(255);
		  END IF;
		END $$;
	  `);
	
	// Allow NULL in key column (migration: key is never stored, only key_hash is)
	await doQuery(`
		DO $$ 
		BEGIN
		  IF EXISTS (
			SELECT 1 FROM information_schema.columns 
			WHERE table_name = 'api_keys' 
			AND column_name = 'key' 
			AND is_nullable = 'NO'
		  ) THEN
			ALTER TABLE api_keys ALTER COLUMN key DROP NOT NULL;
		  END IF;
		END $$;
	  `);
	
	// Add name column to api_keys table if it doesn't exist (migration)
	await doQuery(`
		DO $$ 
		BEGIN
		  IF NOT EXISTS (
			SELECT 1 FROM information_schema.columns 
			WHERE table_name = 'api_keys' AND column_name = 'name'
		  ) THEN
			ALTER TABLE api_keys ADD COLUMN name VARCHAR(255);
		  END IF;
		END $$;
	  `);
	
	// Allow NULL in name column (migration: name is optional for api_keys)
	await doQuery(`
		DO $$ 
		BEGIN
		  IF EXISTS (
			SELECT 1 FROM information_schema.columns 
			WHERE table_name = 'api_keys' 
			AND column_name = 'name' 
			AND is_nullable = 'NO'
		  ) THEN
			ALTER TABLE api_keys ALTER COLUMN name DROP NOT NULL;
		  END IF;
		END $$;
	  `);
	  // add results (json string) column to experiments table if it doesn't exist (migration)
	  await doQuery(`
		DO $$ 
		BEGIN
		  IF NOT EXISTS (
			SELECT 1 FROM information_schema.columns 
			WHERE table_name = 'experiments' AND column_name = 'results'
		  ) THEN
			ALTER TABLE experiments ADD COLUMN results JSONB;
		  END IF;
		END $$;
	  `);
	  // add summary_results (json string) column to experiments table if it doesn't exist (migration)
	  await doQuery(`
		DO $$ 
		BEGIN
		  IF NOT EXISTS (
			SELECT 1 FROM information_schema.columns 
			WHERE table_name = 'experiments' AND column_name = 'summary_results'
		  ) THEN
			ALTER TABLE experiments ADD COLUMN summary_results JSONB;
		  END IF;
		END $$;
	  `);
	  // add name column to experiments table if it doesn't exist (migration)
	  await doQuery(`
		DO $$ 
		BEGIN
		  IF NOT EXISTS (
			SELECT 1 FROM information_schema.columns 
			WHERE table_name = 'experiments' AND column_name = 'name'
		  ) THEN
			ALTER TABLE experiments ADD COLUMN name VARCHAR(255);
		  END IF;
		END $$;
	  `);
	  // add parameters (json object) column to experiments table if it doesn't exist (migration)
	  await doQuery(`
		DO $$ 
		BEGIN
		  IF NOT EXISTS (
			SELECT 1 FROM information_schema.columns 
			WHERE table_name = 'experiments' AND column_name = 'parameters'
		  ) THEN
			ALTER TABLE experiments ADD COLUMN parameters JSONB;
		  END IF;
		END $$;
	  `);
	  // add comparison_parameters (json array) column to experiments table if it doesn't exist (migration)
	  await doQuery(`
		DO $$ 
		BEGIN
		  IF NOT EXISTS (
			SELECT 1 FROM information_schema.columns 
			WHERE table_name = 'experiments' AND column_name = 'comparison_parameters'
		  ) THEN
			ALTER TABLE experiments ADD COLUMN comparison_parameters JSONB;
		  END IF;
		END $$;
	  `);
	    // add subscription (json object) column to organisations table if it doesn't exist (migration)
		await doQuery(`
			DO $$ 
			BEGIN
			  IF NOT EXISTS (
				SELECT 1 FROM information_schema.columns 
				WHERE table_name = 'organisations' AND column_name = 'subscription'
			  ) THEN
				ALTER TABLE organisations ADD COLUMN subscription JSONB;
			  END IF;
			END $$;
		  `);
	// add   max_members?: number;
//   max_datasets?: number;
//   experiment_retention_days?: number;
//   max_examples_per_dataset?: number;
//  to organisations table if it doesn't exist (migration)
// add subscription (json object) column to organisations table if it doesn't exist (migration)
await doQuery(`
	DO $$ 
	BEGIN
	  IF NOT EXISTS (
		SELECT 1 FROM information_schema.columns 
		WHERE table_name = 'organisations' AND column_name = 'max_members'
	  ) THEN
		ALTER TABLE organisations ADD COLUMN max_members INT;
		ALTER TABLE organisations ADD COLUMN max_datasets INT;
		ALTER TABLE organisations ADD COLUMN experiment_retention_days INT;
		ALTER TABLE organisations ADD COLUMN max_examples_per_dataset INT;
	  END IF;
	END $$;
  `);

	// Add role column to api_keys table if it doesn't exist (migration)
	// First, drop read/write columns if they exist (from previous migration)
	await doQuery(`
		DO $$ 
		BEGIN
		  IF EXISTS (
			SELECT 1 FROM information_schema.columns 
			WHERE table_name = 'api_keys' AND column_name = 'read'
		  ) THEN
			ALTER TABLE api_keys DROP COLUMN IF EXISTS read;
			ALTER TABLE api_keys DROP COLUMN IF EXISTS write;
		  END IF;
		END $$;
	  `);
	
	// Add role column
	await doQuery(`
		DO $$ 
		BEGIN
		  IF NOT EXISTS (
			SELECT 1 FROM information_schema.columns 
			WHERE table_name = 'api_keys' AND column_name = 'role'
		  ) THEN
			ALTER TABLE api_keys ADD COLUMN role VARCHAR(20) DEFAULT 'developer';
			-- default all old keys to developer
			UPDATE api_keys SET role = 'developer' WHERE role IS NULL;
		  END IF;
		END $$;
	  `);

	// Add member_settings (JSONB) column to organisations table if it doesn't exist (migration)
	await doQuery(`
		DO $$ 
		BEGIN
		  IF NOT EXISTS (
			SELECT 1 FROM information_schema.columns 
			WHERE table_name = 'organisations' AND column_name = 'member_settings'
		  ) THEN
			ALTER TABLE organisations ADD COLUMN member_settings JSONB;
		  END IF;
		END $$;
	  `);

	// Add key_end column to api_keys table if it doesn't exist (migration)
	await doQuery(`
		DO $$ 
		BEGIN
		  IF NOT EXISTS (
			SELECT 1 FROM information_schema.columns 
			WHERE table_name = 'api_keys' AND column_name = 'key_end'
		  ) THEN
			ALTER TABLE api_keys ADD COLUMN key_end VARCHAR(4);
		  END IF;
		END $$;
	  `);

	// Migration: Drop subscription/limits columns from organisations table (moved to organisation_accounts)
	await doQuery(`
		DO $$ 
		BEGIN
		  IF EXISTS (
			SELECT 1 FROM information_schema.columns 
			WHERE table_name = 'organisations' AND column_name = 'subscription'
		  ) THEN
			ALTER TABLE organisations DROP COLUMN IF EXISTS subscription;
			ALTER TABLE organisations DROP COLUMN IF EXISTS rate_limit_per_hour;
			ALTER TABLE organisations DROP COLUMN IF EXISTS retention_period_days;
			ALTER TABLE organisations DROP COLUMN IF EXISTS max_members;
			ALTER TABLE organisations DROP COLUMN IF EXISTS max_datasets;
			ALTER TABLE organisations DROP COLUMN IF EXISTS experiment_retention_days;
			ALTER TABLE organisations DROP COLUMN IF EXISTS max_examples_per_dataset;
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
	const result = await doQuery<T>(`SELECT * FROM ${tableName} WHERE id = $1`, [id]);
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
		whereClause += ` AND organisation = $1`;
		params.push(organisationId);
	}

	const sql = `SELECT * FROM ${tableName} WHERE ${whereClause} ORDER BY created DESC`;
	const result = await doQuery<T>(sql, params.length > 0 ? params : undefined);
	return transform ? result.rows.map(transform) : result.rows;
}

/**
/**
 * Generic entity creation helper.
 * 
 * Where is ID created? 
 * - If the `item` object contains an `id` field, it will be inserted explicitly.
 * - Otherwise, we rely on the database table to generate a unique ID.
 * 
 * @param tableName The name of the database table to insert into.
 * @param item The object containing fields and values for the new row.
 * @param transform Optional function to transform the returned row before returning.
 * @returns The created entity (optionally transformed).
 */
async function createEntity<T extends QueryResultRow>(
	tableName: string,
	item: Record<string, any>,
	transform?: (row: any) => T
): Promise<T> {
	const filteredItem = filterFields(tableName, item);
	const fields = Object.keys(filteredItem);
	let values = fields.map(field => filteredItem[field]);
	// convert Object values to JSON strings for storage
	// Pass string arrays directly (TEXT[]), but JSON.stringify arrays containing objects (JSONB)
	values = values.map(value => {
		if (value === null || value === undefined) {
			return value;
		}
		if (Array.isArray(value)) {
			// Check if array contains objects - if so, stringify for JSONB columns
			// String arrays (TEXT[]) can be passed directly
			const containsObjects = value.some(item => item !== null && typeof item === 'object' && !Array.isArray(item));
			return containsObjects ? JSON.stringify(value) : value;
		}
		if (typeof value === 'object') {
			return JSON.stringify(value);
		}
		return value;
	});
	const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
	const result = await doQuery<T>(
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
	// Pass string arrays directly (TEXT[]), but JSON.stringify arrays containing objects (JSONB)
	values = values.map(value => {
		if (value === null || value === undefined) {
			return value;
		}
		if (Array.isArray(value)) {
			// Check if array contains objects - if so, stringify for JSONB columns
			// String arrays (TEXT[]) can be passed directly
			const containsObjects = value.some(item => item !== null && typeof item === 'object' && !Array.isArray(item));
			return containsObjects ? JSON.stringify(value) : value;
		}
		if (typeof value === 'object') {
			return JSON.stringify(value);
		}
		return value;
	});

	const setClause = fields.map((field, i) => `${field} = $${i + 1}`).join(', ');
	const idParam = `$${fields.length + 1}`;
	const result = await doQuery<T>(
		`UPDATE ${tableName} SET ${setClause}, updated = NOW() WHERE id = ${idParam} RETURNING *`,
		[...values, id]
	);
	if (!result.rows[0]) return null;
	return transform ? transform(result.rows[0]) : result.rows[0];
}

async function deleteEntity(tableName: string, id: string): Promise<boolean> {
	const result = await doQuery(`DELETE FROM ${tableName} WHERE id = $1`, [id]);
	return (result.rowCount ?? 0) > 0;
}


// Helper function to transform Organisation
function transformOrganisation(row: any): Organisation {
	return {
		...row,
		member_settings: row.member_settings ? (typeof row.member_settings === 'string' ? JSON.parse(row.member_settings) : row.member_settings) : {},
	};
}

// CRUD operations for Organisation
export async function createOrganisation(org: Omit<Organisation, 'created' | 'updated'> & { id?: string }): Promise<Organisation> {
	if ( ! org.member_settings) org.member_settings = {};
	if ( ! org.members) org.members = [];
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

// Helper function to transform OrganisationAccount
function transformOrganisationAccount(row: any): OrganisationAccount {
	return {
		...row,
		subscription: row.subscription ? (typeof row.subscription === 'string' ? JSON.parse(row.subscription) : row.subscription) : { type: 'free', status: 'active', start_date: new Date(), end_date: null, renewal_date: null, price_per_month: 0, currency: 'USD' },
	};
}

// CRUD operations for OrganisationAccount
export async function createOrganisationAccount(account: Omit<OrganisationAccount, 'id' | 'created' | 'updated'>): Promise<OrganisationAccount> {
	if ( ! account.subscription) account.subscription = { type: 'free', status: 'active', start_date: new Date(), end_date: null, renewal_date: null, price_per_month: 0, currency: 'USD' };
	return createEntity<OrganisationAccount>(
		'organisation_accounts', account,
		transformOrganisationAccount
	);
}

export async function getOrganisationAccount(id: string): Promise<OrganisationAccount | null> {
	return getById<OrganisationAccount>('organisation_accounts', id, transformOrganisationAccount);
}

/**
 * Get OrganisationAccount by organisation ID.
 */
export async function getOrganisationAccountByOrganisation(organisationId: string): Promise<OrganisationAccount | null> {
	const result = await doQuery<OrganisationAccount>(
		'SELECT * FROM organisation_accounts WHERE organisation = $1 LIMIT 1',
		[organisationId]
	);
	if (result.rows.length === 0) {
		return null;
	}
	return transformOrganisationAccount(result.rows[0]);
}

export async function updateOrganisationAccount(id: string, updatedItem: Partial<OrganisationAccount>): Promise<OrganisationAccount | null> {
	return updateEntity<OrganisationAccount>('organisation_accounts', id, updatedItem, transformOrganisationAccount);
}

/**
 * Returns true if deleted, false if not found.
 */
export async function deleteOrganisationAccount(id: string): Promise<boolean> {
	return deleteEntity('organisation_accounts', id);
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
 * Get API key by its hash (for authentication).
 */
export async function getApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
	if (!pool) {
		throw new Error('Database pool not initialized. Call initPool() first.');
	}
	const result = await pool.query(
		'SELECT * FROM api_keys WHERE key_hash = $1 LIMIT 1',
		[keyHash]
	);
	if (result.rows.length === 0) {
		return null;
	}
	return transformApiKey(result.rows[0]);
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

	if (updates.name !== undefined) item.name = updates.name;
	if (updates.role !== undefined) item.role = updates.role;

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

	const result = await doQuery<User>(
		`SELECT * FROM users WHERE id = ANY($1)`,
		[org.members]
	);
	return result.rows;
}

/**
 * Find all organisations that a user belongs to (where user ID is in members array).
 * Returns empty array if user is not a member of any organisation.
 * @param searchQuery - Optional Gmail-style search query to filter results (e.g. "name:acme")
 */
export async function getOrganisationsForUser(userId: string, searchQuery?: SearchQuery | string | null): Promise<Organisation[]> {
	const membershipClause = `$1 = ANY(members)`;
	const searchClause = searchQueryToSqlWhereClause(searchQuery);
	const whereClause = searchClause === '1=1' 
		? membershipClause 
		: `${membershipClause} AND (${searchClause})`;
	
	const result = await doQuery<Organisation>(
		`SELECT * FROM organisations WHERE ${whereClause} ORDER BY created DESC`,
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
	let results = row.results;
	if (typeof results === 'string') {
		results = JSON.parse(results);
	}
	// Ensure results is always an array
	if (!Array.isArray(results)) {
		results = [];
	}
	
	return {
		...row,
		summary_results: typeof row.summary_results === 'string' ? JSON.parse(row.summary_results) : row.summary_results,
		parameters: row.parameters !== null && row.parameters !== undefined ? (typeof row.parameters === 'string' ? JSON.parse(row.parameters) : row.parameters) : undefined,
		comparison_parameters: row.comparison_parameters !== null && row.comparison_parameters !== undefined ? (typeof row.comparison_parameters === 'string' ? JSON.parse(row.comparison_parameters) : row.comparison_parameters) : undefined,
		results,
	};
}

// CRUD operations for Experiment

/**
 * summary_results JSON field is automatically serialized.
 */
export async function createExperiment(experiment: Omit<Experiment, 'id' | 'created' | 'updated'>): Promise<Experiment> {
	// fill in any missing fields with defaults
	if ( ! experiment.summary_results) experiment.summary_results = {};
	if ( ! experiment.results) experiment.results = [];
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
 * summary_results, results, parameters, and comparison_parameters JSON fields are automatically serialized.
 */
export async function updateExperiment(id: string, updates: Partial<Experiment>): Promise<Experiment | null> {
	// TODO more reflection less custom code - sending any extra fields is not an issue, and updateEntity should handle updates generically (except for if an array should be converted to json), converting {} to json by default
	const item: Record<string, any> = {};

	if (updates.name !== undefined) item.name = updates.name;
	if (updates.summary_results !== undefined) item.summary_results = JSON.stringify(updates.summary_results);
	if (updates.results !== undefined) item.results = JSON.stringify(updates.results);
	if (updates.parameters !== undefined) item.parameters = updates.parameters !== null && updates.parameters !== undefined ? JSON.stringify(updates.parameters) : null;
	if (updates.comparison_parameters !== undefined) item.comparison_parameters = updates.comparison_parameters !== null && updates.comparison_parameters !== undefined ? JSON.stringify(updates.comparison_parameters) : null;

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

