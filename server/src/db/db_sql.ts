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
import { loadSchema, generatePostgresTable, getTypeDefinition, toSnakeCase } from '../common/utils/schema-loader.js';
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

	// Rate limit events: one row per 429 (trace export rejected due to rate limit)
	await doQuery(`
		CREATE TABLE IF NOT EXISTS rate_limit_events (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			organisation UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
			occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
	

	// Create indexes
		await doQuery(`CREATE INDEX IF NOT EXISTS idx_api_keys_organisation ON api_keys(organisation)`);
	await doQuery(`CREATE INDEX IF NOT EXISTS idx_organisation_accounts_organisation ON organisation_accounts(organisation)`);
	await doQuery(`CREATE INDEX IF NOT EXISTS idx_models_organisation ON models(organisation)`);
	await doQuery(`CREATE INDEX IF NOT EXISTS idx_datasets_organisation ON datasets(organisation)`);
	await doQuery(`CREATE INDEX IF NOT EXISTS idx_experiments_dataset ON experiments(dataset)`);
	await doQuery(`CREATE INDEX IF NOT EXISTS idx_experiments_organisation ON experiments(organisation)`);
	await doQuery(`
		CREATE INDEX IF NOT EXISTS idx_rate_limit_events_organisation_occurred_at
		ON rate_limit_events(organisation, occurred_at)
	`);

	await applyMigrations();
}


// periodically delete this when all existing database tables are up to date
async function applyMigrations(): Promise<void> {
} // end applyMigrations

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
 * @param id Optional ID to use for the new entity. If not provided, the database will generate a unique ID (normally safer).
 * @returns The created entity (optionally transformed).
 */
async function createEntity<T extends QueryResultRow>(
	tableName: string,
	item: Record<string, any>,
	id?: string,
	transform?: (row: any) => T
): Promise<T> {
	const filteredItem = filterFields(tableName, item);
	const fields = Object.keys(filteredItem);
	if (id !== undefined && id !== null) {
		fields.unshift('id');
		filteredItem.id = id;
	}
	const columnNames = fields.map(f => toSnakeCase(f));
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
		`INSERT INTO ${tableName} (${columnNames.join(', ')}) VALUES (${placeholders}) RETURNING *`,
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

	const columnNames = fields.map(f => toSnakeCase(f));
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

	const setClause = columnNames.map((col, i) => `${col} = $${i + 1}`).join(', ');
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


// Helper function to transform Organisation (snake_case columns -> camelCase)
function transformOrganisation(row: any): Organisation {
	const { member_settings, ...rest } = row;
	return {
		...rest,
		memberSettings: member_settings != null ? (typeof member_settings === 'string' ? JSON.parse(member_settings) : member_settings) : {},
	};
}

// CRUD operations for Organisation
export async function createOrganisation(org: Omit<Organisation, 'created' | 'updated'>, id?: string): Promise<Organisation> {
	if ( ! org.memberSettings) org.memberSettings = {};
	if ( ! org.members) org.members = [];
	return createEntity<Organisation>(
		'organisations', org, id,
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

// Helper function to transform OrganisationAccount (subscription JSON may have snake_case or camelCase)
function transformOrganisationAccount(row: any): OrganisationAccount {
	const sub = row.subscription ? (typeof row.subscription === 'string' ? JSON.parse(row.subscription) : row.subscription) : {};
	const subscription = {
		type: sub.type ?? 'free',
		status: sub.status ?? 'active',
		start: sub.start ?? sub.start_date ?? new Date(),
		end: sub.end ?? sub.end_date ?? null,
		renewal: sub.renewal ?? sub.renewal_date ?? null,
		pricePerMonth: sub.pricePerMonth ?? sub.price_per_month ?? 0,
		currency: sub.currency ?? 'USD',
	};
	const { stripe_customer_id, stripe_subscription_id, rate_limit_per_hour, retention_period_days, max_members, max_datasets, experiment_retention_days, max_examples_per_dataset, ...rest } = row;
	return {
		...rest,
		subscription,
		stripeCustomerId: stripe_customer_id ?? rest.stripeCustomerId,
		stripeSubscriptionId: stripe_subscription_id ?? rest.stripeSubscriptionId,
		rateLimitPerHour: rate_limit_per_hour ?? rest.rateLimitPerHour,
		retentionPeriodDays: retention_period_days ?? rest.retentionPeriodDays,
		maxMembers: max_members ?? rest.maxMembers,
		maxDatasets: max_datasets ?? rest.maxDatasets,
		experimentRetentionDays: experiment_retention_days ?? rest.experimentRetentionDays,
		maxExamplesPerDataset: max_examples_per_dataset ?? rest.maxExamplesPerDataset,
	};
}

// CRUD operations for OrganisationAccount
export async function createOrganisationAccount(account: Omit<OrganisationAccount, 'id' | 'created' | 'updated'>): Promise<OrganisationAccount> {
	if ( ! account.subscription) account.subscription = { type: 'free', status: 'active', start: new Date(), end: null, renewal: null, pricePerMonth: 0, currency: 'USD' };
	return createEntity<OrganisationAccount>(
		'organisation_accounts', account, null,
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

/**
 * Record a single rate-limit hit (trace export rejected with 429). Fire-and-forget from caller.
 */
export async function recordRateLimitHit(organisationId: string): Promise<void> {
	await doQuery(
		'INSERT INTO rate_limit_events (organisation) VALUES ($1)',
		[organisationId]
	);
}

/**
 * Count rate-limit hits in the last 24h and last 7d for an organisation.
 */
export async function getRateLimitHits(organisationId: string): Promise<{ last24h: number; last7d: number }> {
	const result = await doQuery<{ last_24h: string; last_7d: string }>(
		`SELECT
			(SELECT COUNT(*) FROM rate_limit_events WHERE organisation = $1 AND occurred_at > now() - interval '24 hours') AS last_24h,
			(SELECT COUNT(*) FROM rate_limit_events WHERE organisation = $1 AND occurred_at > now() - interval '7 days') AS last_7d`,
		[organisationId]
	);
	const row = result.rows[0];
	return {
		last24h: row ? parseInt(row.last_24h, 10) : 0,
		last7d: row ? parseInt(row.last_7d, 10) : 0,
	};
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
		'users', user, null
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

/** Find a user by email (case-insensitive). Returns first match or null. */
export async function getUserByEmail(email: string): Promise<User | null> {
	if (!email || typeof email !== 'string') return null;
	const result = await doQuery<User>(
		'SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
		[email.trim()]
	);
	return result.rows[0] || null;
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

// Helper function to transform ApiKey (snake_case columns -> camelCase)
function transformApiKey(row: any): ApiKey {
	const { key_hash, hash, key_end, ...rest } = row;
	return { ...rest, hash: hash ?? key_hash ?? rest.hash, keyEnd: key_end ?? rest.keyEnd } as ApiKey;
}

// CRUD operations for ApiKey

/**
 */
export async function createApiKey(apiKey: Omit<ApiKey, 'id' | 'created' | 'updated'>): Promise<ApiKey> {
	return createEntity<ApiKey>(
		'api_keys',
		apiKey,
		null,
		transformApiKey
	);
}

export async function getApiKey(id: string): Promise<ApiKey | null> {
	return getById<ApiKey>('api_keys', id, transformApiKey);
}

/**
 * Get API key by its hash (for authentication).
 */
export async function getApiKeyByHash(hash: string): Promise<ApiKey | null> {
	if (!pool) {
		throw new Error('Database pool not initialized. Call initPool() first.');
	}
	const result = await pool.query(
		'SELECT * FROM api_keys WHERE hash = $1 LIMIT 1',
		[hash]
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

/** State shape for add-member logic (members, pending, memberSettings). Matches Organisation fields. */
type MemberState = {
	members: string[];
	memberSettings: NonNullable<Organisation['memberSettings']>;
	pending: string[];
};

/**
 * Pure helper: add userId to members (if not present), optionally remove email from pending,
 * and ensure member_settings[userId] exists with role 'standard'. Used by add-by-email, processPendingMembers, reconcile.
 */
function applyMemberAdd(
	state: MemberState,
	userId: string,
	emailToRemove?: string
): MemberState {
	const members = state.members.includes(userId)
		? state.members
		: [...state.members, userId];
	const memberSettings = { ...state.memberSettings };
	if (!memberSettings[userId]) memberSettings[userId] = { role: 'standard' as const };
	const pending = emailToRemove
		? state.pending.filter((e) => e.toLowerCase() !== emailToRemove.toLowerCase())
		: state.pending;
	return { members, memberSettings, pending };
}

/**
 * Returns patch object to add userId to org (and optionally remove email from pending).
 * Idempotent: safe to call when user is already a member.
 */
function addMemberToOrganisationPatch(
	org: Organisation,
	userId: string,
	removePendingEmail?: string
): Partial<Organisation> {
	const state: MemberState = {
		members: org.members || [],
		memberSettings: org.memberSettings || {},
		pending: org.pending || [],
	};
	return applyMemberAdd(state, userId, removePendingEmail);
}

/**
 * @throws Error if organisation not found
 */
export async function addOrganisationMember(organisationId: string, userId: string): Promise<Organisation> {
	const org = await getOrganisation(organisationId);
	if (!org) {
		throw new Error('Organisation not found');
	}
	if (org.members?.includes(userId)) return org;
	const patch = addMemberToOrganisationPatch(org, userId);
	const updated = await updateOrganisation(organisationId, patch);
	if (!updated) throw new Error('Failed to update organisation');
	return updated;
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
 * Add member by email: if user exists (case-insensitive), add to members and remove from pending;
 * otherwise add email to pending only.
 * @returns Discriminated result for the route to map to responses.
 */
export async function addOrganisationMemberByEmail(
	organisationId: string,
	email: string
): Promise<
	| { kind: 'updated'; org: Organisation }
	| { kind: 'alreadyMember' }
	| { kind: 'alreadyPending' }
	| { kind: 'addedToPending'; org: Organisation }
	| { kind: 'notFound' }
> {
	const org = await getOrganisation(organisationId);
	if (!org) return { kind: 'notFound' };
	const emailLower = (email || '').trim().toLowerCase();
	if (!emailLower) return { kind: 'notFound' };

	const existingUser = await getUserByEmail(email);
	if (existingUser) {
		if (org.members?.includes(existingUser.id)) return { kind: 'alreadyMember' };
		const patch = addMemberToOrganisationPatch(org, existingUser.id, emailLower);
		const updated = await updateOrganisation(organisationId, patch);
		return { kind: 'updated', org: updated ?? org };
	}

	if ((org.pending || []).some((e) => e.toLowerCase() === emailLower)) {
		return { kind: 'alreadyPending' };
	}
	const updated = await updateOrganisation(organisationId, {
		pending: [...(org.pending || []), emailLower],
	});
	return { kind: 'addedToPending', org: updated ?? org };
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
 * Process pending members for a newly created user.
 * Finds all organisations where the user's email is in pending,
 * adds the user to those organisations, and removes the email from pending.
 * @param userId - The ID of the newly created user
 * @param userEmail - The email of the newly created user
 * @returns Array of organisation IDs the user was added to
 */
export async function processPendingMembers(userId: string, userEmail: string): Promise<string[]> {
	if (!userEmail || !userId) {
		return [];
	}

	const emailLower = userEmail.toLowerCase();

	// Find all organisations with this email in pending using SQL query (more efficient than loading all)
	// Handle NULL/empty arrays by checking array is not null and contains the email
	// Assume: email normalisation (eg lowercase) is already done 
	const result = await doQuery<Organisation>(
		`SELECT * FROM organisations WHERE pending IS NOT NULL AND $1 = ANY(pending)`,
		[emailLower]
	);
	// Note: column name is snake_case in DB; transformOrganisation maps to pending
	const orgsWithPendingEmail = result.rows.map(transformOrganisation);

	const addedOrgIds: string[] = [];

	for (const org of orgsWithPendingEmail) {
		try {
			const patch = addMemberToOrganisationPatch(org, userId, emailLower);
			const updated = await updateOrganisation(org.id, patch);

			if (updated) {
				addedOrgIds.push(org.id);
			} else {
				console.warn(`Failed to update organisation ${org.id} when processing pending member ${userEmail}`);
			}
		} catch (error) {
			console.error(`Failed to process pending member for org ${org.id}:`, error);
		}
	}

	return addedOrgIds;
}

/**
 * Reconcile pending with actual users: any email in pending that has a user
 * is moved to members and removed from pending. Fixes the case where a user signed up after
 * being invited but processPendingMembers did not run (e.g. race or different auth path).
 */
export async function reconcileOrganisationPendingMembers(org: Organisation): Promise<Organisation> {
	const pending = org.pending || [];
	if (pending.length === 0) return org;

	let state: MemberState = {
		members: org.members || [],
		memberSettings: org.memberSettings || {},
		pending: [...pending],
	};
	let changed = false;

	for (const email of pending) {
		const user = await getUserByEmail(email);
		if (user) {
			state = applyMemberAdd(state, user.id, email);
			changed = true;
		}
	}
	if (!changed) return org;

	const updated = await updateOrganisation(org.id, state);
	return updated ?? org;
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

// Helper function to transform Dataset (snake_case columns -> camelCase, parse JSON)
function transformDataset(row: any): Dataset {
	const { input_schema: _i, output_schema: _o, ...rest } = row;
	return {
		...rest,
		metrics: row.metrics ? (typeof row.metrics === 'string' ? JSON.parse(row.metrics) : row.metrics) : undefined,
	};
}

// CRUD operations for Dataset

/**
 * JSON field (metrics) is automatically serialized.
 */
export async function createDataset(dataset: Omit<Dataset, 'id' | 'created' | 'updated'>): Promise<Dataset> {
	return createEntity<Dataset>(
		'datasets',
		dataset,
		null,
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
	
	const summariesCol = row.summaries;
	const { comparison_parameters: _dropped, ...rest } = row;
	return {
		...rest,
		summaries: typeof summariesCol === 'string' ? JSON.parse(summariesCol) : summariesCol,
		parameters: row.parameters !== null && row.parameters !== undefined ? (typeof row.parameters === 'string' ? JSON.parse(row.parameters) : row.parameters) : undefined,
		results,
	};
}

// CRUD operations for Experiment

/**
 * summaries JSON field is automatically serialized.
 */
export async function createExperiment(experiment: Omit<Experiment, 'id' | 'created' | 'updated'>): Promise<Experiment> {
	// fill in any missing fields with defaults
	if ( ! experiment.summaries) experiment.summaries = {};
	if ( ! experiment.results) experiment.results = [];
	return createEntity<Experiment>(
		'experiments',
		experiment,
		null,
		transformExperiment
	);
}

/**
 * summaries JSON field is automatically parsed.
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
 * summaries, results, and parameters JSON fields are automatically serialized.
 */
export async function updateExperiment(id: string, updates: Partial<Experiment>): Promise<Experiment | null> {
	// TODO more reflection less custom code - sending any extra fields is not an issue, and updateEntity should handle updates generically (except for if an array should be converted to json), converting {} to json by default
	const item: Record<string, any> = {};

	if (updates.name !== undefined) item.name = updates.name;
	if (updates.summaries !== undefined) item.summaries = JSON.stringify(updates.summaries);
	if (updates.results !== undefined) item.results = JSON.stringify(updates.results);
	if (updates.parameters !== undefined) item.parameters = updates.parameters !== null && updates.parameters !== undefined ? JSON.stringify(updates.parameters) : null;

	return updateEntity<Experiment>('experiments', id, item, transformExperiment);
}

export async function deleteExperiment(id: string): Promise<boolean> {
	return deleteEntity('experiments', id);
}

// Helper function to transform Model (snake_case columns -> camelCase)
function transformModel(row: any): Model {
	const { key, hash, ...rest } = row;
	return { ...rest, key: key, hash } as Model;
}

// CRUD operations for Model
export async function createModel(model: Omit<Model, 'id' | 'created' | 'updated'>): Promise<Model> {
	return createEntity<Model>(
		'models',
		model,
		null,
		transformModel
	);
}

export async function getModel(id: string): Promise<Model | null> {
	return getById<Model>('models', id, transformModel);
}

/**
 * @param organisationId - Organisation ID (required)
 * @param searchQuery - Gmail-style search query or SearchQuery instance. Returns all if null.
 */
export async function listModels(organisationId: string, searchQuery?: SearchQuery | string | null): Promise<Model[]> {
	return listEntities<Model>('models', organisationId, searchQuery, transformModel);
}

export async function updateModel(id: string, updates: Partial<Model>): Promise<Model | null> {
	return updateEntity<Model>('models', id, updates, transformModel);
}

export async function deleteModel(id: string): Promise<boolean> {
	return deleteEntity('models', id);
}

