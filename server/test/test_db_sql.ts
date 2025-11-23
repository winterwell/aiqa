import dotenv from 'dotenv';
import tap from 'tap';
import {
  initPool,
  createSchema,
  closePool,
  getClient,
  createOrganisation,
  getOrganisation,
  listOrganisations,
  updateOrganisation,
  deleteOrganisation,
} from '../dist/src/db_sql.js';

dotenv.config();

tap.before(async () => {
  // Initialize database connection
  const pgConnectionString = process.env.DATABASE_URL || 
    `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}/${process.env.PGDATABASE}?sslmode=${process.env.PGSSLMODE || 'require'}`;
  
  initPool(pgConnectionString);
  
  // Create schema (tables and indexes)
  await createSchema();
});

tap.after(async () => {
  await closePool();
});

tap.test('database initialization', async (t) => {
  // Test that we can query the database (schema was created)
  const client = await getClient();
  
  try {
    // Check that organisations table exists
    const result = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'organisations'
      );
    `);
    
    t.equal(result.rows[0].exists, true, 'organisations table should exist');
    
    // Check that other tables exist too
    const tables = ['users', 'api_keys', 'models', 'datasets', 'experiments'];
    for (const table of tables) {
      const tableResult = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = $1
        );
      `, [table]);
      t.equal(tableResult.rows[0].exists, true, `${table} table should exist`);
    }
  } finally {
    client.release();
  }
});

tap.test('create organisation', async (t) => {
  const org = await createOrganisation({
    name: 'Test Org Create',
    rate_limit_per_hour: 1000,
    retention_period_days: 30,
    members: [],
  });
  
  t.ok(org.id, 'should have an id');
  t.equal(org.name, 'Test Org Create', 'should have correct name');
  t.equal(org.rate_limit_per_hour, 1000, 'should have correct rate_limit_per_hour');
  t.equal(org.retention_period_days, 30, 'should have correct retention_period_days');
  t.ok(Array.isArray(org.members), 'members should be an array');
  t.ok(org.created instanceof Date, 'should have created timestamp');
  t.ok(org.updated instanceof Date, 'should have updated timestamp');
});

tap.test('get organisation by id', async (t) => {
  // Create an organisation first
  const user1Id = '11111111-1111-1111-1111-111111111111';
  const user2Id = '22222222-2222-2222-2222-222222222222';
  const created = await createOrganisation({
    name: 'Test Org Get',
    rate_limit_per_hour: 2000,
    retention_period_days: 60,
    members: [user1Id, user2Id],
  });
  
  // Retrieve it
  const retrieved = await getOrganisation(created.id);
  
  t.ok(retrieved, 'should retrieve organisation');
  t.equal(retrieved!.id, created.id, 'should have matching id');
  t.equal(retrieved!.name, 'Test Org Get', 'should have correct name');
  t.equal(retrieved!.rate_limit_per_hour, 2000, 'should have correct rate_limit_per_hour');
  t.equal(retrieved!.retention_period_days, 60, 'should have correct retention_period_days');
  t.same(retrieved!.members, [user1Id, user2Id], 'should have correct members');
  
  // Test non-existent organisation
  const nonExistent = await getOrganisation('00000000-0000-0000-0000-000000000000');
  t.equal(nonExistent, null, 'should return null for non-existent organisation');
});

tap.test('list organisations', async (t) => {
  // Create a few test organisations with unique names
  const uniqueId = Date.now().toString();
  const org1Name = `List Org Alpha ${uniqueId}`;
  const org2Name = `List Org Beta ${uniqueId}`;
  
  const org1 = await createOrganisation({
    name: org1Name,
    rate_limit_per_hour: 100,
    members: [],
  });
  
  const org2 = await createOrganisation({
    name: org2Name,
    rate_limit_per_hour: 200,
    members: [],
  });
  
  // List all organisations
  const allOrgs = await listOrganisations();
  t.ok(Array.isArray(allOrgs), 'should return an array');
  t.ok(allOrgs.length >= 2, 'should have at least 2 organisations');
  
  // Find our test organisations in the list
  const foundOrg1 = allOrgs.find(o => o.id === org1.id);
  const foundOrg2 = allOrgs.find(o => o.id === org2.id);
  
  t.ok(foundOrg1, 'should find org1 in list');
  t.ok(foundOrg2, 'should find org2 in list');
  t.equal(foundOrg1!.name, org1Name, 'org1 should have correct name');
  t.equal(foundOrg2!.name, org2Name, 'org2 should have correct name');
  
  // Test with search query - use the unique name to avoid conflicts
  const filteredOrgs = await listOrganisations(`name:${org1Name}`);
  t.equal(filteredOrgs.length, 1, 'should find exactly one organisation with search query');
  t.equal(filteredOrgs[0].id, org1.id, 'should find the correct organisation');
});

tap.test('update organisation', async (t) => {
  // Create an organisation
  const user1Id = '11111111-1111-1111-1111-111111111111';
  const user2Id = '22222222-2222-2222-2222-222222222222';
  const user3Id = '33333333-3333-3333-3333-333333333333';
  const created = await createOrganisation({
    name: 'Test Org Update',
    rate_limit_per_hour: 500,
    retention_period_days: 15,
    members: [user1Id],
  });
  
  const originalUpdated = created.updated;
  
  // Wait a bit to ensure updated timestamp changes
  await new Promise(resolve => setTimeout(resolve, 10));
  
  // Update name and rate_limit_per_hour
  const updated = await updateOrganisation(created.id, {
    name: 'Test Org Updated',
    rate_limit_per_hour: 1500,
  });
  
  t.ok(updated, 'should return updated organisation');
  t.equal(updated!.id, created.id, 'should have same id');
  t.equal(updated!.name, 'Test Org Updated', 'should have updated name');
  t.equal(updated!.rate_limit_per_hour, 1500, 'should have updated rate_limit_per_hour');
  t.equal(updated!.retention_period_days, 15, 'should preserve retention_period_days');
  t.same(updated!.members, [user1Id], 'should preserve members');
  t.ok(updated!.updated.getTime() > originalUpdated.getTime(), 'updated timestamp should change');
  
  // Update members
  const updatedWithMembers = await updateOrganisation(created.id, {
    members: [user1Id, user2Id, user3Id],
  });
  
  t.same(updatedWithMembers!.members, [user1Id, user2Id, user3Id], 'should update members');
  
  // Test updating non-existent organisation
  const nonExistent = await updateOrganisation('00000000-0000-0000-0000-000000000000', {
    name: 'Should Not Exist',
  });
  t.equal(nonExistent, null, 'should return null for non-existent organisation');
});

tap.test('delete organisation', async (t) => {
  // Create an organisation
  const created = await createOrganisation({
    name: 'Test Org Delete',
    rate_limit_per_hour: 300,
    members: [],
  });
  
  // Verify it exists
  const beforeDelete = await getOrganisation(created.id);
  t.ok(beforeDelete, 'organisation should exist before delete');
  
  // Delete it
  const deleted = await deleteOrganisation(created.id);
  t.equal(deleted, true, 'should return true when deleting existing organisation');
  
  // Verify it's gone
  const afterDelete = await getOrganisation(created.id);
  t.equal(afterDelete, null, 'organisation should not exist after delete');
  
  // Test deleting non-existent organisation
  const nonExistent = await deleteOrganisation('00000000-0000-0000-0000-000000000000');
  t.equal(nonExistent, false, 'should return false when deleting non-existent organisation');
});

tap.test('full CRUD workflow', async (t) => {
  // Create
  const user1Id = '11111111-1111-1111-1111-111111111111';
  const org = await createOrganisation({
    name: 'CRUD Test Org',
    rate_limit_per_hour: 1000,
    retention_period_days: 90,
    members: [user1Id],
  });
  
  t.ok(org.id, 'should create organisation with id');
  
  // Read
  const retrieved = await getOrganisation(org.id);
  t.ok(retrieved, 'should retrieve created organisation');
  t.equal(retrieved!.name, 'CRUD Test Org', 'should have correct name');
  
  // Update
  const updated = await updateOrganisation(org.id, {
    name: 'CRUD Test Org Updated',
    rate_limit_per_hour: 2000,
  });
  t.equal(updated!.name, 'CRUD Test Org Updated', 'should update name');
  t.equal(updated!.rate_limit_per_hour, 2000, 'should update rate_limit_per_hour');
  
  // Verify update persisted
  const retrievedAfterUpdate = await getOrganisation(org.id);
  t.equal(retrievedAfterUpdate!.name, 'CRUD Test Org Updated', 'update should persist');
  
  // Delete
  const deleted = await deleteOrganisation(org.id);
  t.equal(deleted, true, 'should delete organisation');
  
  // Verify deletion
  const retrievedAfterDelete = await getOrganisation(org.id);
  t.equal(retrievedAfterDelete, null, 'organisation should be deleted');
});

