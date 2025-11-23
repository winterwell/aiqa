export interface JsonSchema {
  $ref?: string;
  definitions?: Record<string, {
    properties?: Record<string, any>;
    required?: string[];
    type?: string;
  }>;
}

import { getSchema } from './schema-registry.js';

/**
 * Load a JSON schema file for a type
 * Schemas are imported and bundled into the build, so no file system access is needed
 */
export function loadSchema(typeName: string): JsonSchema {
  return getSchema(typeName);
}

/**
 * Get the type definition from a JSON schema
 */
export function getTypeDefinition(schema: JsonSchema, typeName: string): any {
  if (schema.definitions && schema.definitions[typeName]) {
    return schema.definitions[typeName];
  }
  // Try to get from $ref
  if (schema.$ref) {
    const refName = schema.$ref.split('/').pop() || typeName;
    return schema.definitions?.[refName];
  }
  return null;
}

/**
 * Convert JSON Schema type to PostgreSQL type
 */
export function jsonSchemaToPostgresType(prop: any, fieldName: string): string {
  const type = prop.type;
  
  // Handle special cases
  if (fieldName === 'id') {
    return 'UUID PRIMARY KEY DEFAULT gen_random_uuid()';
  }
  
  if (fieldName === 'created' || fieldName === 'updated') {
    return 'TIMESTAMP DEFAULT NOW()';
  }
  
  if (fieldName === 'members') {
    return "TEXT[] DEFAULT '{}'";
  }
  
  if (fieldName.includes('_id') && fieldName !== 'id') {
    return 'UUID NOT NULL';
  }
  
  switch (type) {
    case 'string':
      if (prop.format === 'date-time') {
        return 'TIMESTAMP DEFAULT NOW()';
      }
      // Check for enums or specific formats
      if (fieldName.includes('hash') || fieldName.includes('key')) {
        return 'VARCHAR(255) NOT NULL UNIQUE';
      }
      if (fieldName === 'email') {
        return 'VARCHAR(255) NOT NULL UNIQUE';
      }
      if (fieldName === 'name') {
        return 'VARCHAR(255) NOT NULL';
      }
      return 'VARCHAR(255)';
    case 'number':
      return 'INTEGER';
    case 'boolean':
      return 'BOOLEAN';
    case 'array':
      if (prop.items?.type === 'string') {
        return 'TEXT[]';
      }
      return 'JSONB';
    case 'object':
    default:
      return 'JSONB';
  }
}

/**
 * Convert PascalCase/camelCase to snake_case
 */
function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

/**
 * Convert type name to PostgreSQL table name (snake_case, pluralized)
 */
function typeNameToTableName(typeName: string): string {
  const snakeCase = toSnakeCase(typeName);
  // Simple pluralization: add 's' (works for most cases)
  return `${snakeCase}s`;
}

/**
 * Convert JSON Schema to PostgreSQL CREATE TABLE statement
 */
export function generatePostgresTable(
  typeName: string,
  schema: JsonSchema,
  additionalColumns: Record<string, string> = {},
  constraints: string[] = []
): string {
  const def = getTypeDefinition(schema, typeName);
  if (!def || !def.properties) {
    throw new Error(`Could not find type definition for ${typeName}`);
  }
  
  const columns: string[] = [];
  const columnMap = new Map<string, string>();
  const required = def.required || [];
  
  // Add columns from schema
  for (const [fieldName, prop] of Object.entries(def.properties)) {
    const pgType = jsonSchemaToPostgresType(prop, fieldName);
    const isRequired = required.includes(fieldName);
    const notNull = isRequired && !pgType.includes('DEFAULT') ? ' NOT NULL' : '';
    columnMap.set(fieldName, `${pgType}${notNull}`);
  }
  
  // Override or add additional columns (for foreign keys, etc.)
  for (const [fieldName, columnDef] of Object.entries(additionalColumns)) {
    columnMap.set(fieldName, columnDef);
  }
  
  // Convert map to array of column definitions
  for (const [fieldName, columnDef] of columnMap.entries()) {
    columns.push(`  ${fieldName} ${columnDef}`);
  }
  
  // Add constraints
  columns.push(...constraints);
  
  const tableName = typeNameToTableName(typeName);
  return `CREATE TABLE IF NOT EXISTS ${tableName} (\n${columns.join(',\n')}\n)`;
}

/**
 * Convert JSON Schema property to Elasticsearch mapping
 */
export function jsonSchemaToEsMapping(prop: any, fieldName: string): any {
  const type = prop.type;
  
  if (fieldName === '@timestamp' || (fieldName.includes('timestamp') || fieldName.includes('created') || fieldName.includes('updated'))) {
    return { type: 'date' };
  }
  
  if (fieldName.includes('_id') || fieldName === 'id') {
    return { type: 'keyword' };
  }
  
  switch (type) {
    case 'string':
      if (fieldName === 'name') {
        return { type: 'text', fields: { keyword: { type: 'keyword' } } };
      }
      return { type: 'keyword' };
    case 'number':
      return { type: 'float' };
    case 'boolean':
      return { type: 'boolean' };
    case 'array':
      if (prop.items?.type === 'string') {
        return { type: 'keyword' };
      }
      return { type: 'nested' };
    case 'object':
      return {
        type: 'object',
        properties: {}
      };
    default:
      return { type: 'keyword' };
  }
}

