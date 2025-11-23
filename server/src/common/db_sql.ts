import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import {
  Organisation,
  User,
  ApiKey,
  Model,
  Dataset,
  Experiment,
} from './types/index.js';
import SearchQuery from './SearchQuery.js';
import { loadSchema, generatePostgresTable } from './utils/schema-loader.js';

let pool: Pool | null = null;

export function initPool(connectionString?: string): void {
  if (connectionString) {
    pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  } else {
    // Use environment variables (PGHOST, PGDATABASE, PGUSER, PGPASSWORD, etc.)
    pool = new Pool({
      host: process.env.PGHOST,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
}

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
  return pool.query<T>(text, params);
}

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
  await query(`CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_api_keys_organisation_id ON api_keys(organisation_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_models_organisation_id ON models(organisation_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_datasets_organisation_id ON datasets(organisation_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_experiments_dataset_id ON experiments(dataset_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_experiments_organisation_id ON experiments(organisation_id)`);
}

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
  searchQuery?: SearchQuery | string | null,
  transform?: (row: any) => T
): Promise<T[]> {
  const whereClause = searchQueryToWhereClause(searchQuery);
  const result = await query<T>(`SELECT * FROM ${tableName} WHERE ${whereClause} ORDER BY created DESC`);
  return transform ? result.rows.map(transform) : result.rows;
}

async function createEntity<T extends QueryResultRow>(
  tableName: string,
  fields: string[],
  values: any[],
  transform?: (row: any) => T
): Promise<T> {
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
  fields: string[],
  values: any[],
  transform?: (row: any) => T
): Promise<T | null> {
  if (fields.length === 0) {
    return getById<T>(tableName, id, transform);
  }
  
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

// Helper function to convert SearchQuery to SQL WHERE clause
function searchQueryToWhereClause(sq: SearchQuery | string | null | undefined): string {
  if (!sq) return '1=1';
  const searchQuery = typeof sq === 'string' ? new SearchQuery(sq) : sq;
  return searchQueryToSqlWhereClause(searchQuery);
}

function searchQueryToSqlWhereClause(sq: SearchQuery): string {
  if (!sq.tree || sq.tree.length === 0) return '1=1';
  return searchQueryToSqlWhereClause2(sq.tree);
}

function searchQueryToSqlWhereClause2(tree: any[] | any): string {
  if (typeof tree === 'string') {
    return `'${tree.replace(/'/g, "''")}'`;
  }
  if (!Array.isArray(tree)) {
    return String(tree);
  }
  if (tree.length === 1) {
    return typeof tree[0] === 'string' ? `'${tree[0].replace(/'/g, "''")}'` : String(tree[0]);
  }
  if (typeof tree === 'object' && !Array.isArray(tree)) {
    const keys = Object.keys(tree);
    if (keys.length === 1) {
      const key = keys[0];
      const value = tree[key];
      return `${key} = ${searchQueryToSqlWhereClause2([value])}`;
    }
  }
  const op = tree[0];
  const bits = tree.slice(1);
  const ubits = bits.map((bit: any) => {
    if (typeof bit === 'object' && !Array.isArray(bit)) {
      const keys = Object.keys(bit);
      if (keys.length === 1) {
        const key = keys[0];
        const value = bit[key];
        return `${key} = ${searchQueryToSqlWhereClause2([value])}`;
      }
    }
    return searchQueryToSqlWhereClause2(Array.isArray(bit) ? bit : [bit]);
  });
  const sqlOp = op === 'OR' ? 'OR' : 'AND';
  return `(${ubits.join(` ${sqlOp} `)})`;
}

// Helper function to transform Organisation (map rate_limit -> rate_limit_per_hour)
function transformOrganisation(row: any): Organisation {
  const { rate_limit, ...rest } = row;
  return {
    ...rest,
    rate_limit_per_hour: rate_limit,
  } as Organisation;
}

// CRUD operations for Organisation
export async function createOrganisation(org: Omit<Organisation, 'id' | 'created' | 'updated'>): Promise<Organisation> {
  return createEntity<Organisation>(
    'organisations',
    ['name', 'rate_limit', 'retention_period_days', 'members'],
    [org.name, org.rate_limit_per_hour, org.retention_period_days, org.members || []],
    transformOrganisation
  );
}

export async function getOrganisation(id: string): Promise<Organisation | null> {
  return getById<Organisation>('organisations', id, transformOrganisation);
}

export async function listOrganisations(searchQuery?: SearchQuery | string | null): Promise<Organisation[]> {
  return listEntities<Organisation>('organisations', searchQuery, transformOrganisation);
}

export async function updateOrganisation(id: string, updates: Partial<Organisation>): Promise<Organisation | null> {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push('name');
    values.push(updates.name);
  }
  if (updates.rate_limit_per_hour !== undefined) {
    fields.push('rate_limit');
    values.push(updates.rate_limit_per_hour);
  }
  if (updates.retention_period_days !== undefined) {
    fields.push('retention_period_days');
    values.push(updates.retention_period_days);
  }
  if (updates.members !== undefined) {
    fields.push('members');
    values.push(updates.members);
  }

  return updateEntity<Organisation>('organisations', id, fields, values, transformOrganisation);
}

export async function deleteOrganisation(id: string): Promise<boolean> {
  return deleteEntity('organisations', id);
}

// CRUD operations for User
export async function createUser(user: Omit<User, 'id' | 'created' | 'updated'>): Promise<User> {
  return createEntity<User>(
    'users',
    ['email', 'name'],
    [user.email, user.name]
  );
}

export async function getUser(id: string): Promise<User | null> {
  return getById<User>('users', id);
}

export async function listUsers(searchQuery?: SearchQuery | string | null): Promise<User[]> {
  return listEntities<User>('users', searchQuery);
}

export async function updateUser(id: string, updates: Partial<User>): Promise<User | null> {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.email !== undefined) {
    fields.push('email');
    values.push(updates.email);
  }
  if (updates.name !== undefined) {
    fields.push('name');
    values.push(updates.name);
  }

  return updateEntity<User>('users', id, fields, values);
}

export async function deleteUser(id: string): Promise<boolean> {
  return deleteEntity('users', id);
}

// Helper function to transform ApiKey (map rate_limit -> rate_limit_per_hour)
function transformApiKey(row: any): ApiKey {
  const { rate_limit, ...rest } = row;
  return {
    ...rest,
    rate_limit_per_hour: rate_limit,
  } as ApiKey;
}

// CRUD operations for ApiKey
export async function createApiKey(apiKey: Omit<ApiKey, 'id' | 'created' | 'updated'>): Promise<ApiKey> {
  return createEntity<ApiKey>(
    'api_keys',
    ['organisation_id', 'key_hash', 'rate_limit', 'retention_period_days'],
    [apiKey.organisation_id, apiKey.key_hash, apiKey.rate_limit_per_hour, apiKey.retention_period_days],
    transformApiKey
  );
}

export async function getApiKey(id: string): Promise<ApiKey | null> {
  return getById<ApiKey>('api_keys', id, transformApiKey);
}

export async function getApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
  const result = await query<ApiKey>(`SELECT * FROM api_keys WHERE key_hash = $1`, [keyHash]);
  if (!result.rows[0]) return null;
  return transformApiKey(result.rows[0]);
}

export async function listApiKeys(searchQuery?: SearchQuery | string | null): Promise<ApiKey[]> {
  return listEntities<ApiKey>('api_keys', searchQuery, transformApiKey);
}

export async function updateApiKey(id: string, updates: Partial<ApiKey>): Promise<ApiKey | null> {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.rate_limit_per_hour !== undefined) {
    fields.push('rate_limit');
    values.push(updates.rate_limit_per_hour);
  }
  if (updates.retention_period_days !== undefined) {
    fields.push('retention_period_days');
    values.push(updates.retention_period_days);
  }

  return updateEntity<ApiKey>('api_keys', id, fields, values, transformApiKey);
}

export async function deleteApiKey(id: string): Promise<boolean> {
  return deleteEntity('api_keys', id);
}

// Organisation Member operations
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

export async function removeOrganisationMember(organisationId: string, userId: string): Promise<boolean> {
  const org = await getOrganisation(organisationId);
  if (!org) {
    return false;
  }
  
  const members = (org.members || []).filter(id => id !== userId);
  const updated = await updateOrganisation(organisationId, { members });
  return updated !== null && members.length < (org.members || []).length;
}

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
export async function createDataset(dataset: Omit<Dataset, 'id' | 'created' | 'updated'>): Promise<Dataset> {
  return createEntity<Dataset>(
    'datasets',
    ['organisation_id', 'name', 'description', 'tags', 'input_schema', 'output_schema', 'metrics'],
    [
      dataset.organisation_id,
      dataset.name,
      dataset.description || null,
      dataset.tags || null,
      dataset.input_schema ? JSON.stringify(dataset.input_schema) : null,
      dataset.output_schema ? JSON.stringify(dataset.output_schema) : null,
      dataset.metrics ? JSON.stringify(dataset.metrics) : null,
    ],
    transformDataset
  );
}

export async function getDataset(id: string): Promise<Dataset | null> {
  return getById<Dataset>('datasets', id, transformDataset);
}

export async function listDatasets(searchQuery?: SearchQuery | string | null): Promise<Dataset[]> {
  return listEntities<Dataset>('datasets', searchQuery, transformDataset);
}

export async function updateDataset(id: string, updates: Partial<Dataset>): Promise<Dataset | null> {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push('name');
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push('description');
    values.push(updates.description);
  }
  if (updates.tags !== undefined) {
    fields.push('tags');
    values.push(updates.tags);
  }
  if (updates.input_schema !== undefined) {
    fields.push('input_schema');
    values.push(JSON.stringify(updates.input_schema));
  }
  if (updates.output_schema !== undefined) {
    fields.push('output_schema');
    values.push(JSON.stringify(updates.output_schema));
  }
  if (updates.metrics !== undefined) {
    fields.push('metrics');
    values.push(JSON.stringify(updates.metrics));
  }

  return updateEntity<Dataset>('datasets', id, fields, values, transformDataset);
}

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
export async function createExperiment(experiment: Omit<Experiment, 'id' | 'created' | 'updated'>): Promise<Experiment> {
  return createEntity<Experiment>(
    'experiments',
    ['dataset_id', 'organisation_id', 'summary_results'],
    [
      experiment.dataset_id,
      experiment.organisation_id,
      JSON.stringify(experiment.summary_results),
    ],
    transformExperiment
  );
}

export async function getExperiment(id: string): Promise<Experiment | null> {
  return getById<Experiment>('experiments', id, transformExperiment);
}

export async function listExperiments(searchQuery?: SearchQuery | string | null): Promise<Experiment[]> {
  return listEntities<Experiment>('experiments', searchQuery, transformExperiment);
}

export async function updateExperiment(id: string, updates: Partial<Experiment>): Promise<Experiment | null> {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.summary_results !== undefined) {
    fields.push('summary_results');
    values.push(JSON.stringify(updates.summary_results));
  }

  return updateEntity<Experiment>('experiments', id, fields, values, transformExperiment);
}

export async function deleteExperiment(id: string): Promise<boolean> {
  return deleteEntity('experiments', id);
}

// CRUD operations for Model
export async function createModel(model: Omit<Model, 'id' | 'created' | 'updated'>): Promise<Model> {
  return createEntity<Model>(
    'models',
    ['organisation_id', 'name', 'api_key', 'version', 'description'],
    [
      model.organisation_id,
      model.name,
      model.api_key,
      model.version || null,
      model.description || null,
    ]
  );
}

export async function getModel(id: string): Promise<Model | null> {
  return getById<Model>('models', id);
}

export async function listModels(searchQuery?: SearchQuery | string | null): Promise<Model[]> {
  return listEntities<Model>('models', searchQuery);
}

export async function updateModel(id: string, updates: Partial<Model>): Promise<Model | null> {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push('name');
    values.push(updates.name);
  }
  if (updates.api_key !== undefined) {
    fields.push('api_key');
    values.push(updates.api_key);
  }
  if (updates.version !== undefined) {
    fields.push('version');
    values.push(updates.version);
  }
  if (updates.description !== undefined) {
    fields.push('description');
    values.push(updates.description);
  }

  return updateEntity<Model>('models', id, fields, values);
}

export async function deleteModel(id: string): Promise<boolean> {
  return deleteEntity('models', id);
}

