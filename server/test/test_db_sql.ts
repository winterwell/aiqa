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
  addOrganisationMemberByEmail,
  createUser,
  getUserByEmail,
  processPendingMembers,
  reconcileOrganisationPendingMembers,
  createDataset,
  getDataset,
  deleteDataset,
  createExperiment,
  getExperiment,
  listExperiments,
  updateExperiment,
  deleteExperiment,
  deleteUser,
} from '../dist/db/db_sql.js';

dotenv.config();

// DB tests are slow (many serial queries); default tap timeout (30s) is too short when run alone.
tap.setTimeout(60000);

let dbAvailable = true;

tap.before(async () => {
  const pgConnectionString = process.env.DATABASE_URL ||
    `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}/${process.env.PGDATABASE}?sslmode=${process.env.PGSSLMODE || 'require'}`;

  try {
    initPool(pgConnectionString);
    await createTables();
  } catch (_e) {
    dbAvailable = false;
  }
});

tap.after(async () => {
  await closePool();
});

tap.test('database initialization', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
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
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const org = await createOrganisation({
    name: 'Test Org Create',
    members: [],
  });
  
  t.ok(org.id, 'should have an id');
  t.equal(org.name, 'Test Org Create', 'should have correct name');
  t.ok(Array.isArray(org.members), 'members should be an array');
  t.ok(org.created instanceof Date, 'should have created timestamp');
  t.ok(org.updated instanceof Date, 'should have updated timestamp');
  await deleteOrganisation(org.id);
});

tap.test('get organisation by id', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
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
  await deleteOrganisation(created.id);
});

tap.test('list organisations', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
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
  await deleteOrganisation(org1.id);
  await deleteOrganisation(org2.id);
});

tap.test('update organisation', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
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
  await deleteOrganisation(created.id);
});

tap.test('delete organisation', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
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
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
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

// getUserByEmail (integration, real DB)
tap.test('getUserByEmail returns user when email exists', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const email = `getbyemail-${Date.now()}@example.com`;
  const created = await createUser({ email, name: 'GetByEmail User', sub: `test-sub-${email}` });
  const found = await getUserByEmail(email);
  t.ok(found, 'should find user');
  t.equal(found!.id, created.id, 'should match created user id');
  t.equal(found!.email, created.email, 'should match email');
  t.equal(found!.name, created.name, 'should match name');
  await deleteUser(created.id);
});

tap.test('getUserByEmail returns null for non-existent email', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const found = await getUserByEmail('no-such-user-' + Date.now() + '@example.com');
  t.equal(found, null, 'should return null');
});

tap.test('getUserByEmail is case-insensitive', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const base = `case-${Date.now()}`;
  const email = `${base}@Example.COM`;
  const created = await createUser({ email, name: 'Case User', sub: `test-sub-${email}` });
  t.ok(await getUserByEmail(email), 'same case should find');
  t.ok(await getUserByEmail(`${base}@example.com`), 'lowercase should find');
  t.ok(await getUserByEmail(`${base}@EXAMPLE.COM`), 'uppercase should find');
  await deleteUser(created.id);
});

tap.test('getUserByEmail returns null for empty or invalid input', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  t.equal(await getUserByEmail(''), null, 'empty string returns null');
  t.equal(await getUserByEmail('   '), null, 'whitespace-only returns null');
});

// Add member by email (uses addOrganisationMemberByEmail; same behaviour as POST /organisation/:id/member)
tap.test('add member by email: existing user added to members', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const email = `member-${Date.now()}@example.com`;
  const user = await createUser({ email, name: 'Member User', sub: `test-sub-${email}` });
  const org = await createOrganisation({ name: 'Org Add Member', members: [] });
  const result = await addOrganisationMemberByEmail(org.id, email);
  t.equal(result.kind, 'updated', 'should return updated');
  t.ok(result.kind === 'updated' && result.org.members?.includes(user.id), 'org should include user in members');
  t.ok(result.kind === 'updated' && !(result.org.pending ?? []).some((e: string) => e.toLowerCase() === email.toLowerCase()), 'pending should not contain email');
  await deleteOrganisation(org.id);
  await deleteUser(user.id);
});

tap.test('add member by email: existing user in pending is moved to members', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const email = `pending-to-member-${Date.now()}@example.com`;
  const user = await createUser({ email, name: 'Pending To Member', sub: `test-sub-${email}` });
  const org = await createOrganisation({
    name: 'Org Pending To Member',
    members: [],
    pending: [email.toLowerCase()],
  });
  const result = await addOrganisationMemberByEmail(org.id, email);
  t.equal(result.kind, 'updated', 'should return updated');
  t.ok(result.kind === 'updated' && result.org.members?.includes(user.id), 'user should be in members');
  t.ok(result.kind === 'updated' && !(result.org.pending ?? []).some((e: string) => e.toLowerCase() === email.toLowerCase()), 'email should be removed from pending');
  await deleteOrganisation(org.id);
  await deleteUser(user.id);
});

tap.test('add member by email: unknown email added to pending only', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const email = `pending-only-${Date.now()}@example.com`;
  const org = await createOrganisation({ name: 'Org Pending Only', members: [], pending: [] });
  const result = await addOrganisationMemberByEmail(org.id, email);
  t.equal(result.kind, 'addedToPending', 'should return addedToPending');
  t.ok(result.kind === 'addedToPending' && (result.org.pending ?? []).some((e: string) => e.toLowerCase() === email.toLowerCase()), 'email should be in pending');
  t.same(result.kind === 'addedToPending' ? result.org.members ?? [] : [], org.members ?? [], 'members should be unchanged');
  await deleteOrganisation(org.id);
});

// processPendingMembers tests
tap.test('processPendingMembers: converts pending to members when user signs up', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const email = `process-pending-${Date.now()}@example.com`;
  const emailLower = email.toLowerCase();
  
  // Create org with pending member
  const org = await createOrganisation({
    name: 'Org Process Pending',
    members: [],
    pending: [emailLower],
  });
  
  // Create user with matching email
  const user = await createUser({ email, name: 'Process Pending User', sub: `test-sub-${email}` });
  
  // Process pending members
  const addedOrgIds = await processPendingMembers(user.id, user.email);
  
  t.equal(addedOrgIds.length, 1, 'should return one org ID');
  t.equal(addedOrgIds[0], org.id, 'should return correct org ID');
  
  // Verify org was updated
  const updatedOrg = await getOrganisation(org.id);
  t.ok(updatedOrg, 'org should exist');
  t.ok(updatedOrg!.members?.includes(user.id), 'user should be in members');
  t.ok(!(updatedOrg!.pending ?? []).some((e: string) => e.toLowerCase() === emailLower), 'email should be removed from pending');
  t.ok(updatedOrg!.memberSettings?.[user.id], 'user should have member_settings');
  t.equal(updatedOrg!.memberSettings?.[user.id]?.role, 'standard', 'user should have standard role');
  await deleteOrganisation(org.id);
  await deleteUser(user.id);
});

tap.test('processPendingMembers: handles multiple organisations with same pending email', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const email = `multi-org-pending-${Date.now()}@example.com`;
  const emailLower = email.toLowerCase();
  
  // Create multiple orgs with same pending member
  const org1 = await createOrganisation({
    name: 'Org Multi 1',
    members: [],
    pending: [emailLower],
  });
  const org2 = await createOrganisation({
    name: 'Org Multi 2',
    members: [],
    pending: [emailLower],
  });
  const org3 = await createOrganisation({
    name: 'Org Multi 3',
    members: [],
    pending: [emailLower],
  });
  
  // Create user
  const user = await createUser({ email, name: 'Multi Org User', sub: `test-sub-${email}` });
  
  // Process pending members
  const addedOrgIds = await processPendingMembers(user.id, user.email);
  
  t.equal(addedOrgIds.length, 3, 'should return three org IDs');
  t.ok(addedOrgIds.includes(org1.id), 'should include org1');
  t.ok(addedOrgIds.includes(org2.id), 'should include org2');
  t.ok(addedOrgIds.includes(org3.id), 'should include org3');
  
  // Verify all orgs were updated
  const updatedOrg1 = await getOrganisation(org1.id);
  const updatedOrg2 = await getOrganisation(org2.id);
  const updatedOrg3 = await getOrganisation(org3.id);
  
  t.ok(updatedOrg1!.members?.includes(user.id), 'user should be in org1 members');
  t.ok(updatedOrg2!.members?.includes(user.id), 'user should be in org2 members');
  t.ok(updatedOrg3!.members?.includes(user.id), 'user should be in org3 members');
  
  t.ok(!(updatedOrg1!.pending ?? []).some((e: string) => e.toLowerCase() === emailLower), 'email should be removed from org1 pending');
  t.ok(!(updatedOrg2!.pending ?? []).some((e: string) => e.toLowerCase() === emailLower), 'email should be removed from org2 pending');
  t.ok(!(updatedOrg3!.pending ?? []).some((e: string) => e.toLowerCase() === emailLower), 'email should be removed from org3 pending');
  await deleteOrganisation(org1.id);
  await deleteOrganisation(org2.id);
  await deleteOrganisation(org3.id);
  await deleteUser(user.id);
});

tap.test('processPendingMembers: handles case-insensitive email matching', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const email = `CaseTest-${Date.now()}@Example.COM`;
  const emailLower = email.toLowerCase();
  
  // Create org with lowercase pending member
  const org = await createOrganisation({
    name: 'Org Case Test',
    members: [],
    pending: [emailLower],
  });
  
  // Create user with mixed case email
  const user = await createUser({ email, name: 'Case Test User', sub: `test-sub-${email}` });
  
  // Process pending members
  const addedOrgIds = await processPendingMembers(user.id, user.email);
  
  t.equal(addedOrgIds.length, 1, 'should return one org ID');
  
  const updatedOrg = await getOrganisation(org.id);
  t.ok(updatedOrg!.members?.includes(user.id), 'user should be in members');
  t.ok(!(updatedOrg!.pending ?? []).some((e: string) => e.toLowerCase() === emailLower), 'email should be removed from pending');
  await deleteOrganisation(org.id);
  await deleteUser(user.id);
});

tap.test('processPendingMembers: returns empty array when no pending members found', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const email = `no-pending-${Date.now()}@example.com`;
  
  // Create org without pending members
  const org = await createOrganisation({
    name: 'Org No Pending',
    members: [],
    pending: [],
  });
  
  // Create user
  const user = await createUser({ email, name: 'No Pending User', sub: `test-sub-${email}` });
  
  // Process pending members
  const addedOrgIds = await processPendingMembers(user.id, user.email);
  
  t.equal(addedOrgIds.length, 0, 'should return empty array');
  await deleteOrganisation(org.id);
  await deleteUser(user.id);
});

tap.test('processPendingMembers: handles empty or invalid input', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const result1 = await processPendingMembers('', 'test@example.com');
  const result2 = await processPendingMembers('user-id', '');
  const result3 = await processPendingMembers('', '');
  
  t.equal(result1.length, 0, 'should return empty array for empty userId');
  t.equal(result2.length, 0, 'should return empty array for empty email');
  t.equal(result3.length, 0, 'should return empty array for both empty');
});

tap.test('processPendingMembers: is idempotent - can be called multiple times safely', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const email = `idempotent-${Date.now()}@example.com`;
  const emailLower = email.toLowerCase();
  
  const org = await createOrganisation({
    name: 'Org Idempotent',
    members: [],
    pending: [emailLower],
  });
  
  const user = await createUser({ email, name: 'Idempotent User', sub: `test-sub-${email}` });
  
  // Call multiple times
  const result1 = await processPendingMembers(user.id, user.email);
  const result2 = await processPendingMembers(user.id, user.email);
  const result3 = await processPendingMembers(user.id, user.email);
  
  t.equal(result1.length, 1, 'first call should return org ID');
  t.equal(result2.length, 0, 'second call should return empty (already processed)');
  t.equal(result3.length, 0, 'third call should return empty (already processed)');
  
  const updatedOrg = await getOrganisation(org.id);
  t.ok(updatedOrg!.members?.includes(user.id), 'user should be in members');
  t.equal(updatedOrg!.members?.filter(id => id === user.id).length, 1, 'user should appear only once in members');
  await deleteOrganisation(org.id);
  await deleteUser(user.id);
});

// reconcileOrganisationPendingMembers tests
tap.test('reconcileOrganisationPendingMembers: converts pending to members for existing users', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const email1 = `reconcile-1-${Date.now()}@example.com`;
  const email2 = `reconcile-2-${Date.now()}@example.com`;
  const email3 = `reconcile-3-${Date.now()}@example.com`;
  const emailLower1 = email1.toLowerCase();
  const emailLower2 = email2.toLowerCase();
  const emailLower3 = email3.toLowerCase();
  
  // Create users
  const user1 = await createUser({ email: email1, name: 'Reconcile User 1', sub: `test-sub-${email1}` });
  const user2 = await createUser({ email: email2, name: 'Reconcile User 2', sub: `test-sub-${email2}` });
  // user3 doesn't exist yet
  
  // Create org with mix of pending members (some have users, some don't)
  const org = await createOrganisation({
    name: 'Org Reconcile',
    members: [],
    pending: [emailLower1, emailLower2, emailLower3],
  });
  
  // Reconcile
  const reconciled = await reconcileOrganisationPendingMembers(org);
  
  t.ok(reconciled.members?.includes(user1.id), 'user1 should be in members');
  t.ok(reconciled.members?.includes(user2.id), 'user2 should be in members');
  t.ok(!reconciled.pending?.includes(emailLower1), 'email1 should be removed from pending');
  t.ok(!reconciled.pending?.includes(emailLower2), 'email2 should be removed from pending');
  t.ok(reconciled.pending?.includes(emailLower3), 'email3 should remain in pending (no user yet)');
  t.equal(reconciled.pending?.length, 1, 'should have one remaining pending member');
  await deleteOrganisation(org.id);
  await deleteUser(user1.id);
  await deleteUser(user2.id);
});

tap.test('reconcileOrganisationPendingMembers: returns org unchanged when no pending members', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const org = await createOrganisation({
    name: 'Org No Pending Reconcile',
    members: [],
    pending: [],
  });
  
  const reconciled = await reconcileOrganisationPendingMembers(org);
  
  t.equal(reconciled.id, org.id, 'should return same org');
  t.same(reconciled.members, org.members, 'members should be unchanged');
  t.same(reconciled.pending, org.pending, 'pending should be unchanged');
  await deleteOrganisation(org.id);
});

tap.test('reconcileOrganisationPendingMembers: returns org unchanged when all pending emails have no users', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const email1 = `no-user-1-${Date.now()}@example.com`;
  const email2 = `no-user-2-${Date.now()}@example.com`;
  const emailLower1 = email1.toLowerCase();
  const emailLower2 = email2.toLowerCase();
  
  const org = await createOrganisation({
    name: 'Org No Users',
    members: [],
    pending: [emailLower1, emailLower2],
  });
  
  const reconciled = await reconcileOrganisationPendingMembers(org);
  
  t.equal(reconciled.id, org.id, 'should return same org');
  t.same(reconciled.pending, org.pending, 'pending should be unchanged');
  t.same(reconciled.members, org.members, 'members should be unchanged');
  await deleteOrganisation(org.id);
});

tap.test('reconcileOrganisationPendingMembers: handles case-insensitive email matching', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const email = `CaseReconcile-${Date.now()}@Example.COM`;
  const emailLower = email.toLowerCase();
  
  const user = await createUser({ email, name: 'Case Reconcile User', sub: `test-sub-${email}` });
  
  const org = await createOrganisation({
    name: 'Org Case Reconcile',
    members: [],
    pending: [emailLower],
  });
  
  const reconciled = await reconcileOrganisationPendingMembers(org);
  
  t.ok(reconciled.members?.includes(user.id), 'user should be in members');
  t.ok(!reconciled.pending?.includes(emailLower), 'email should be removed from pending');
  await deleteOrganisation(org.id);
  await deleteUser(user.id);
});

tap.test('reconcileOrganisationPendingMembers: preserves existing members', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const existingUserId = '11111111-1111-1111-1111-111111111111';
  const email = `preserve-${Date.now()}@example.com`;
  const emailLower = email.toLowerCase();
  
  const newUser = await createUser({ email, name: 'Preserve User', sub: `test-sub-${email}` });
  
  const org = await createOrganisation({
    name: 'Org Preserve',
    members: [existingUserId],
    pending: [emailLower],
  });
  
  const reconciled = await reconcileOrganisationPendingMembers(org);
  
  t.ok(reconciled.members?.includes(existingUserId), 'existing member should be preserved');
  t.ok(reconciled.members?.includes(newUser.id), 'new user should be added to members');
  t.equal(reconciled.members?.length, 2, 'should have two members');
  await deleteOrganisation(org.id);
  await deleteUser(newUser.id);
});

tap.test('reconcileOrganisationPendingMembers: does not add duplicate members', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
  const email = `duplicate-${Date.now()}@example.com`;
  const emailLower = email.toLowerCase();
  
  const user = await createUser({ email, name: 'Duplicate User', sub: `test-sub-${email}` });
  
  // Create org with user already in members and also in pending
  const org = await createOrganisation({
    name: 'Org Duplicate',
    members: [user.id],
    pending: [emailLower],
  });
  
  const reconciled = await reconcileOrganisationPendingMembers(org);
  
  t.ok(reconciled.members?.includes(user.id), 'user should be in members');
  t.equal(reconciled.members?.filter(id => id === user.id).length, 1, 'user should appear only once');
  t.ok(!reconciled.pending?.includes(emailLower), 'email should be removed from pending');
  await deleteOrganisation(org.id);
  await deleteUser(user.id);
});

// Experiment tests
tap.test('create experiment', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
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
    summaries: { accuracy: { average: 0.95, min: 0.8, max: 1.0 } },
    results: [
      {
        example: 'example-1',
        scores: { accuracy: 0.9, f1: 0.85 },
      },
    ],
  });
  
  t.ok(experiment.id, 'should have an id');
  t.equal(experiment.name, 'Test Experiment', 'should have correct name');
  t.equal(experiment.dataset, dataset.id, 'should have correct dataset');
  t.equal(experiment.organisation, org.id, 'should have correct organisation');
  t.same(experiment.parameters, { model: 'gpt-4', temperature: 0.7 }, 'should have correct parameters');
  t.same(experiment.summaries, { accuracy: { average: 0.95, min: 0.8, max: 1.0 } }, 'should have correct summaries');
  t.ok(Array.isArray(experiment.results), 'results should be an array');
  t.equal(experiment.results!.length, 1, 'should have one result');
  t.equal(experiment.results![0].example, 'example-1', 'result should have correct example');
  t.ok(experiment.created instanceof Date, 'should have created timestamp');
  t.ok(experiment.updated instanceof Date, 'should have updated timestamp');
  await deleteExperiment(experiment.id);
  await deleteDataset(dataset.id);
  await deleteOrganisation(org.id);
});

tap.test('get experiment by id', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
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
    summaries: { accuracy: { average: 0.9 } },
  });
  
  // Retrieve it
  const retrieved = await getExperiment(created.id);
  
  t.ok(retrieved, 'should retrieve experiment');
  t.equal(retrieved!.id, created.id, 'should have matching id');
  t.equal(retrieved!.name, 'Get Test Experiment', 'should have correct name');
  t.same(retrieved!.parameters, { model: 'gpt-4' }, 'should have correct parameters');
  t.same(retrieved!.summaries, { accuracy: { average: 0.9 } }, 'should have correct summaries');
  
  // Test non-existent experiment
  const nonExistent = await getExperiment('00000000-0000-0000-0000-000000000000');
  t.equal(nonExistent, null, 'should return null for non-existent experiment');
  await deleteExperiment(created.id);
  await deleteDataset(dataset.id);
  await deleteOrganisation(org.id);
});

tap.test('list experiments', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
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
  await deleteExperiment(exp1.id);
  await deleteExperiment(exp2.id);
  await deleteDataset(dataset.id);
  await deleteOrganisation(org.id);
});

tap.test('update experiment', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
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
    summaries: { accuracy: { average: 0.8 } },
  });
  
  const originalUpdated = created.updated;
  
  // Update name, parameters, and summaries
  const updated = await updateExperiment(created.id, {
    name: 'Updated Experiment Name',
    parameters: { model: 'gpt-4o', temperature: 0.9 },
    summaries: { accuracy: { average: 0.95, min: 0.8, max: 1.0 } },
  });
  
  t.ok(updated, 'should return updated experiment');
  t.equal(updated!.id, created.id, 'should have same id');
  t.equal(updated!.name, 'Updated Experiment Name', 'should have updated name');
  t.same(updated!.parameters, { model: 'gpt-4o', temperature: 0.9 }, 'should have updated parameters');
  t.same(updated!.summaries, { accuracy: { average: 0.95, min: 0.8, max: 1.0 } }, 'should have updated summaries');
  t.ok(updated!.updated.getTime() > originalUpdated.getTime(), 'updated timestamp should change');
  
  // Test updating non-existent experiment
  const nonExistent = await updateExperiment('00000000-0000-0000-0000-000000000000', {
    name: 'Should Not Exist',
  });
  t.equal(nonExistent, null, 'should return null for non-existent experiment');
  await deleteExperiment(created.id);
  await deleteDataset(dataset.id);
  await deleteOrganisation(org.id);
});

tap.test('delete experiment', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
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
  await deleteDataset(dataset.id);
  await deleteOrganisation(org.id);
});

tap.test('experiment JSON fields handling', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
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
  
  const created = await createExperiment({
    dataset: dataset.id,
    organisation: org.id,
    name: 'JSON Test Experiment',
    parameters: complexParams,
    summaries: {
      accuracy: { average: 0.95, min: 0.8, max: 1.0, variance: 0.01 },
      f1: { average: 0.92, count: 100 },
    },
    results: [
      {
        example: 'ex1',
        scores: { accuracy: 0.9, f1: 0.85 },
        errors: { metric1: 'some error' },
      },
      {
        example: 'ex2',
        scores: { accuracy: 1.0, f1: 0.95 },
      },
    ],
  });
  
  // Verify JSON fields are correctly stored and retrieved
  t.same(created.parameters, complexParams, 'complex parameters should be preserved');
  t.equal(created.results!.length, 2, 'should have 2 results');
  t.equal(created.results![0].example, 'ex1', 'first result should have correct example');
  t.same(created.results![0].scores, { accuracy: 0.9, f1: 0.85 }, 'first result should have correct scores');
  t.same(created.results![0].errors, { metric1: 'some error' }, 'first result should have correct errors');
  
  // Retrieve and verify again
  const retrieved = await getExperiment(created.id);
  t.same(retrieved!.parameters, complexParams, 'retrieved parameters should match');
  t.equal(retrieved!.results!.length, 2, 'retrieved should have 2 results');
  
  // Test updating with null/undefined
  const updated = await updateExperiment(created.id, {
    parameters: null,
  });
  
  t.equal(updated!.parameters, undefined, 'parameters should be null/undefined after update');
  await deleteExperiment(created.id);
  await deleteDataset(dataset.id);
  await deleteOrganisation(org.id);
});

tap.test('experiment full CRUD workflow', async (t) => {
  if (!dbAvailable) {
    t.skip('Database not available');
    return;
  }
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
    summaries: { accuracy: { average: 0.9 } },
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
    summaries: { accuracy: { average: 0.95 } },
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
  await deleteDataset(dataset.id);
  await deleteOrganisation(org.id);
});

