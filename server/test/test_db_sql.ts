import dotenv from 'dotenv';
import tap from 'tap';
import {
  initPool,
  createTables,
  closePool,
  getClient,
  createOrganisation,
  getOrganisation,
  listOrganisations,
  updateOrganisation,
  deleteOrganisation,
  createDataset,
  getDataset,
  createExperiment,
  getExperiment,
  listExperiments,
  updateExperiment,
  deleteExperiment,
} from '../dist/db/db_sql.js';

dotenv.config();

tap.before(async () => {
  // Initialize database connection
  const pgConnectionString = process.env.DATABASE_URL || 
    `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}/${process.env.PGDATABASE}?sslmode=${process.env.PGSSLMODE || 'require'}`;
  
  initPool(pgConnectionString);
  
  // Create schema (tables and indexes)
  await createTables();
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
    members: [],
  });
  
  t.ok(org.id, 'should have an id');
  t.equal(org.name, 'Test Org Create', 'should have correct name');
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
    members: [user1Id, user2Id],
  });
  
  // Retrieve it
  const retrieved = await getOrganisation(created.id);
  
  t.ok(retrieved, 'should retrieve organisation');
  t.equal(retrieved!.id, created.id, 'should have matching id');
  t.equal(retrieved!.name, 'Test Org Get', 'should have correct name');
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
    members: [],
  });
  
  const org2 = await createOrganisation({
    name: org2Name,
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
  // Quote the value since it contains spaces
  const filteredOrgs = await listOrganisations(`name:"${org1Name}"`);
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
    members: [user1Id],
  });
  
  const originalUpdated = created.updated;
  
  // Update name
  const updated = await updateOrganisation(created.id, {
    name: 'Test Org Updated',
  });
  
  t.ok(updated, 'should return updated organisation');
  t.equal(updated!.id, created.id, 'should have same id');
  t.equal(updated!.name, 'Test Org Updated', 'should have updated name');
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
  });
  t.equal(updated!.name, 'CRUD Test Org Updated', 'should update name');
  
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

// Experiment tests
tap.test('create experiment', async (t) => {
  // Create organisation and dataset first
  const org = await createOrganisation({
    name: 'Test Org for Experiment',
    members: [],
  });
  
  const dataset = await createDataset({
    organisation: org.id,
    name: 'Test Dataset',
    description: 'Test dataset for experiments',
  });
  
  const experiment = await createExperiment({
    dataset: dataset.id,
    organisation: org.id,
    name: 'Test Experiment',
    parameters: { model: 'gpt-4', temperature: 0.7 },
    comparison_parameters: [
      { model: 'gpt-4o', temperature: 0.5 },
      { model: 'gpt-4o-mini', temperature: 0.5 },
    ],
    summary_results: { accuracy: { average: 0.95, min: 0.8, max: 1.0 } },
    results: [
      {
        exampleId: 'example-1',
        scores: { accuracy: 0.9, f1: 0.85 },
      },
    ],
  });
  
  t.ok(experiment.id, 'should have an id');
  t.equal(experiment.name, 'Test Experiment', 'should have correct name');
  t.equal(experiment.dataset, dataset.id, 'should have correct dataset');
  t.equal(experiment.organisation, org.id, 'should have correct organisation');
  t.same(experiment.parameters, { model: 'gpt-4', temperature: 0.7 }, 'should have correct parameters');
  t.same(experiment.comparison_parameters, [
    { model: 'gpt-4o', temperature: 0.5 },
    { model: 'gpt-4o-mini', temperature: 0.5 },
  ], 'should have correct comparison_parameters');
  t.same(experiment.summary_results, { accuracy: { average: 0.95, min: 0.8, max: 1.0 } }, 'should have correct summary_results');
  t.ok(Array.isArray(experiment.results), 'results should be an array');
  t.equal(experiment.results!.length, 1, 'should have one result');
  t.equal(experiment.results![0].exampleId, 'example-1', 'result should have correct exampleId');
  t.ok(experiment.created instanceof Date, 'should have created timestamp');
  t.ok(experiment.updated instanceof Date, 'should have updated timestamp');
});

tap.test('get experiment by id', async (t) => {
  // Create organisation and dataset first
  const org = await createOrganisation({
    name: 'Test Org for Get Experiment',
    members: [],
  });
  
  const dataset = await createDataset({
    organisation: org.id,
    name: 'Test Dataset for Get',
  });
  
  const created = await createExperiment({
    dataset: dataset.id,
    organisation: org.id,
    name: 'Get Test Experiment',
    parameters: { model: 'gpt-4' },
    summary_results: { accuracy: { average: 0.9 } },
  });
  
  // Retrieve it
  const retrieved = await getExperiment(created.id);
  
  t.ok(retrieved, 'should retrieve experiment');
  t.equal(retrieved!.id, created.id, 'should have matching id');
  t.equal(retrieved!.name, 'Get Test Experiment', 'should have correct name');
  t.same(retrieved!.parameters, { model: 'gpt-4' }, 'should have correct parameters');
  t.same(retrieved!.summary_results, { accuracy: { average: 0.9 } }, 'should have correct summary_results');
  
  // Test non-existent experiment
  const nonExistent = await getExperiment('00000000-0000-0000-0000-000000000000');
  t.equal(nonExistent, null, 'should return null for non-existent experiment');
});

tap.test('list experiments', async (t) => {
  // Create organisation and dataset first
  const org = await createOrganisation({
    name: 'Test Org for List Experiments',
    members: [],
  });
  
  const dataset = await createDataset({
    organisation: org.id,
    name: 'Test Dataset for List',
  });
  
  const uniqueId = Date.now().toString();
  const exp1Name = `List Experiment Alpha ${uniqueId}`;
  const exp2Name = `List Experiment Beta ${uniqueId}`;
  
  const exp1 = await createExperiment({
    dataset: dataset.id,
    organisation: org.id,
    name: exp1Name,
  });
  
  const exp2 = await createExperiment({
    dataset: dataset.id,
    organisation: org.id,
    name: exp2Name,
  });
  
  // List all experiments for organisation
  const allExps = await listExperiments(org.id);
  t.ok(Array.isArray(allExps), 'should return an array');
  t.ok(allExps.length >= 2, 'should have at least 2 experiments');
  
  // Find our test experiments in the list
  const foundExp1 = allExps.find(e => e.id === exp1.id);
  const foundExp2 = allExps.find(e => e.id === exp2.id);
  
  t.ok(foundExp1, 'should find exp1 in list');
  t.ok(foundExp2, 'should find exp2 in list');
  t.equal(foundExp1!.name, exp1Name, 'exp1 should have correct name');
  t.equal(foundExp2!.name, exp2Name, 'exp2 should have correct name');
});

tap.test('update experiment', async (t) => {
  // Create organisation and dataset first
  const org = await createOrganisation({
    name: 'Test Org for Update Experiment',
    members: [],
  });
  
  const dataset = await createDataset({
    organisation: org.id,
    name: 'Test Dataset for Update',
  });
  
  const created = await createExperiment({
    dataset: dataset.id,
    organisation: org.id,
    name: 'Update Test Experiment',
    parameters: { model: 'gpt-4' },
    summary_results: { accuracy: { average: 0.8 } },
  });
  
  const originalUpdated = created.updated;
  
  // Update name, parameters, and summary_results
  const updated = await updateExperiment(created.id, {
    name: 'Updated Experiment Name',
    parameters: { model: 'gpt-4o', temperature: 0.9 },
    summary_results: { accuracy: { average: 0.95, min: 0.8, max: 1.0 } },
  });
  
  t.ok(updated, 'should return updated experiment');
  t.equal(updated!.id, created.id, 'should have same id');
  t.equal(updated!.name, 'Updated Experiment Name', 'should have updated name');
  t.same(updated!.parameters, { model: 'gpt-4o', temperature: 0.9 }, 'should have updated parameters');
  t.same(updated!.summary_results, { accuracy: { average: 0.95, min: 0.8, max: 1.0 } }, 'should have updated summary_results');
  t.ok(updated!.updated.getTime() > originalUpdated.getTime(), 'updated timestamp should change');
  
  // Update comparison_parameters
  const updatedWithComparison = await updateExperiment(created.id, {
    comparison_parameters: [
      { model: 'gpt-4o', temperature: 0.5 },
      { model: 'gpt-4o-mini', temperature: 0.3 },
    ],
  });
  
  t.same(updatedWithComparison!.comparison_parameters, [
    { model: 'gpt-4o', temperature: 0.5 },
    { model: 'gpt-4o-mini', temperature: 0.3 },
  ], 'should update comparison_parameters');
  
  // Test updating non-existent experiment
  const nonExistent = await updateExperiment('00000000-0000-0000-0000-000000000000', {
    name: 'Should Not Exist',
  });
  t.equal(nonExistent, null, 'should return null for non-existent experiment');
});

tap.test('delete experiment', async (t) => {
  // Create organisation and dataset first
  const org = await createOrganisation({
    name: 'Test Org for Delete Experiment',
    members: [],
  });
  
  const dataset = await createDataset({
    organisation: org.id,
    name: 'Test Dataset for Delete',
  });
  
  const created = await createExperiment({
    dataset: dataset.id,
    organisation: org.id,
    name: 'Delete Test Experiment',
  });
  
  // Verify it exists
  const beforeDelete = await getExperiment(created.id);
  t.ok(beforeDelete, 'experiment should exist before delete');
  
  // Delete it
  const deleted = await deleteExperiment(created.id);
  t.equal(deleted, true, 'should return true when deleting existing experiment');
  
  // Verify it's gone
  const afterDelete = await getExperiment(created.id);
  t.equal(afterDelete, null, 'experiment should not exist after delete');
  
  // Test deleting non-existent experiment
  const nonExistent = await deleteExperiment('00000000-0000-0000-0000-000000000000');
  t.equal(nonExistent, false, 'should return false when deleting non-existent experiment');
});

tap.test('experiment JSON fields handling', async (t) => {
  // Create organisation and dataset first
  const org = await createOrganisation({
    name: 'Test Org for JSON Experiment',
    members: [],
  });
  
  const dataset = await createDataset({
    organisation: org.id,
    name: 'Test Dataset for JSON',
  });
  
  // Test creating with complex JSON structures
  const complexParams = {
    model: 'gpt-4',
    temperature: 0.7,
    max_tokens: 1000,
    system_prompt: 'You are a helpful assistant',
    nested: {
      key: 'value',
      array: [1, 2, 3],
    },
  };
  
  const complexComparison = [
    { model: 'gpt-4o', config: { temp: 0.5 } },
    { model: 'gpt-4o-mini', config: { temp: 0.3 } },
  ];
  
  const created = await createExperiment({
    dataset: dataset.id,
    organisation: org.id,
    name: 'JSON Test Experiment',
    parameters: complexParams,
    comparison_parameters: complexComparison,
    summary_results: {
      accuracy: { average: 0.95, min: 0.8, max: 1.0, variance: 0.01 },
      f1: { average: 0.92, count: 100 },
    },
    results: [
      {
        exampleId: 'ex1',
        scores: { accuracy: 0.9, f1: 0.85 },
        errors: { metric1: 'some error' },
      },
      {
        exampleId: 'ex2',
        scores: { accuracy: 1.0, f1: 0.95 },
      },
    ],
  });
  
  // Verify JSON fields are correctly stored and retrieved
  t.same(created.parameters, complexParams, 'complex parameters should be preserved');
  t.same(created.comparison_parameters, complexComparison, 'complex comparison_parameters should be preserved');
  t.equal(created.results!.length, 2, 'should have 2 results');
  t.equal(created.results![0].exampleId, 'ex1', 'first result should have correct exampleId');
  t.same(created.results![0].scores, { accuracy: 0.9, f1: 0.85 }, 'first result should have correct scores');
  t.same(created.results![0].errors, { metric1: 'some error' }, 'first result should have correct errors');
  
  // Retrieve and verify again
  const retrieved = await getExperiment(created.id);
  t.same(retrieved!.parameters, complexParams, 'retrieved parameters should match');
  t.same(retrieved!.comparison_parameters, complexComparison, 'retrieved comparison_parameters should match');
  t.equal(retrieved!.results!.length, 2, 'retrieved should have 2 results');
  
  // Test updating with null/undefined
  const updated = await updateExperiment(created.id, {
    parameters: null,
    comparison_parameters: undefined, // Should not update
  });
  
  t.equal(updated!.parameters, undefined, 'parameters should be null/undefined after update');
  t.same(updated!.comparison_parameters, complexComparison, 'comparison_parameters should remain unchanged when undefined');
});

tap.test('experiment full CRUD workflow', async (t) => {
  // Create organisation and dataset first
  const org = await createOrganisation({
    name: 'Test Org for CRUD Experiment',
    members: [],
  });
  
  const dataset = await createDataset({
    organisation: org.id,
    name: 'Test Dataset for CRUD',
  });
  
  // Create
  const experiment = await createExperiment({
    dataset: dataset.id,
    organisation: org.id,
    name: 'CRUD Test Experiment',
    parameters: { model: 'gpt-4' },
    summary_results: { accuracy: { average: 0.9 } },
  });
  
  t.ok(experiment.id, 'should create experiment with id');
  
  // Read
  const retrieved = await getExperiment(experiment.id);
  t.ok(retrieved, 'should retrieve created experiment');
  t.equal(retrieved!.name, 'CRUD Test Experiment', 'should have correct name');
  
  // Update
  const updated = await updateExperiment(experiment.id, {
    name: 'CRUD Test Experiment Updated',
    parameters: { model: 'gpt-4o', temperature: 0.8 },
    summary_results: { accuracy: { average: 0.95 } },
  });
  t.equal(updated!.name, 'CRUD Test Experiment Updated', 'should update name');
  t.same(updated!.parameters, { model: 'gpt-4o', temperature: 0.8 }, 'should update parameters');
  
  // Verify update persisted
  const retrievedAfterUpdate = await getExperiment(experiment.id);
  t.equal(retrievedAfterUpdate!.name, 'CRUD Test Experiment Updated', 'update should persist');
  t.same(retrievedAfterUpdate!.parameters, { model: 'gpt-4o', temperature: 0.8 }, 'parameters update should persist');
  
  // Delete
  const deleted = await deleteExperiment(experiment.id);
  t.equal(deleted, true, 'should delete experiment');
  
  // Verify deletion
  const retrievedAfterDelete = await getExperiment(experiment.id);
  t.equal(retrievedAfterDelete, null, 'experiment should be deleted');
});

