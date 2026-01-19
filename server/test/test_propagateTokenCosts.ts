import tap from 'tap';
import Span from '../dist/common/types/Span.js';
import { 
  propagateTokenCostsToRootSpan,
  getTokenUsage,
  addTokenUsageToSpan,
  spanIdToHash,
  TokenStats,
  PropagateTokenCostsDependencies
} from '../dist/routes/spans.js';
import SearchQuery from '../dist/common/SearchQuery.js';

/**
 * Helper to create a test span
 */
function createTestSpan(
  id: string,
  name: string,
  parentId?: string,
  tokenUsage?: Partial<TokenStats>,
  organisation: string = 'test-org'
): Span {
  const attrs: any = {};
  if (tokenUsage) {
    if (tokenUsage.inputTokens !== undefined) attrs['gen_ai.usage.input_tokens'] = tokenUsage.inputTokens;
    if (tokenUsage.outputTokens !== undefined) attrs['gen_ai.usage.output_tokens'] = tokenUsage.outputTokens;
    if (tokenUsage.cachedInputTokens !== undefined) attrs['gen_ai.usage.cached_input_tokens'] = tokenUsage.cachedInputTokens;
    if (tokenUsage.totalTokens !== undefined) attrs['gen_ai.usage.total_tokens'] = tokenUsage.totalTokens;
    if (tokenUsage.cost !== undefined) attrs['gen_ai.cost.usd'] = tokenUsage.cost;
  }
  
  return {
    id,
    name,
    traceId: 'test-trace',
    organisation,
    kind: 1,
    startTime: Date.now(),
    endTime: Date.now() + 100,
    status: { code: 1 },
    attributes: attrs,
    links: [],
    events: [],
    resource: { attributes: {} },
    instrumentationLibrary: { name: 'test' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    starred: false,
    _seen: [],
    ...(parentId && { parentSpanId: parentId }),
  } as Span;
}

tap.test('getTokenUsage - extracts token usage from span attributes', t => {
  const span = createTestSpan('span1', 'test', undefined, {
    inputTokens: 100,
    outputTokens: 50,
    cachedInputTokens: 10,
    totalTokens: 150,
    cost: 0.001
  });
  
  const usage = getTokenUsage(span);
  t.equal(usage.inputTokens, 100);
  t.equal(usage.outputTokens, 50);
  t.equal(usage.cachedInputTokens, 10);
  t.equal(usage.totalTokens, 150);
  t.equal(usage.cost, 0.001);
  t.end();
});

tap.test('getTokenUsage - returns zeros for span without token usage', t => {
  const span = createTestSpan('span1', 'test');
  const usage = getTokenUsage(span);
  t.equal(usage.inputTokens, 0);
  t.equal(usage.outputTokens, 0);
  t.equal(usage.cachedInputTokens, 0);
  t.equal(usage.totalTokens, 0);
  t.equal(usage.cost, 0);
  t.end();
});

tap.test('addTokenUsageToSpan - adds token usage to span', t => {
  const span = createTestSpan('span1', 'test', undefined, {
    inputTokens: 10,
    outputTokens: 5,
    cost: 0.0001
  });
  
  addTokenUsageToSpan(span, {
    inputTokens: 20,
    outputTokens: 15,
    cachedInputTokens: 5,
    totalTokens: 40,
    cost: 0.0002
  });
  
  t.equal(span.attributes!['gen_ai.usage.input_tokens'], 30);
  t.equal(span.attributes!['gen_ai.usage.output_tokens'], 20);
  t.equal(span.attributes!['gen_ai.usage.cached_input_tokens'], 5);
  t.equal(span.attributes!['gen_ai.usage.total_tokens'], 40);
  // Use approximate comparison for floating point
  t.ok(Math.abs((span.attributes!['gen_ai.cost.usd'] as number) - 0.0003) < 0.000001, 'cost should be approximately 0.0003');
  t.end();
});

tap.test('spanIdToHash - converts span ID to hash', t => {
  const hash1 = spanIdToHash('test-span-id-123');
  const hash2 = spanIdToHash('test-span-id-123');
  const hash3 = spanIdToHash('different-id');
  
  t.ok(hash1 !== null, 'should return a hash');
  t.equal(hash1, hash2, 'same ID should produce same hash');
  t.ok(hash1 !== hash3, 'different IDs should produce different hashes');
  t.equal(spanIdToHash(undefined), null, 'undefined should return null');
  t.equal(spanIdToHash(''), null, 'empty string should return null');
  t.end();
});

tap.test('propagateTokenCostsToRootSpan - simple parent-child propagation', async t => {
  const child = createTestSpan('child', 'child-span', 'parent', {
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.001
  });
  
  const parent = createTestSpan('parent', 'parent-span', undefined, {
    inputTokens: 10,
    outputTokens: 5,
    cost: 0.0001
  });
  
  const spans = [child, parent];
  
  await propagateTokenCostsToRootSpan(spans);
  
  // Parent should have aggregated tokens from child
  const parentUsage = getTokenUsage(parent);
  t.equal(parentUsage.inputTokens, 110); // 10 + 100
  t.equal(parentUsage.outputTokens, 55); // 5 + 50
  t.equal(parentUsage.cost, 0.0011); // 0.0001 + 0.001
  
  // Parent should have child in _seen
  t.ok((parent as any)._seen.includes(spanIdToHash('child')!), 'parent should have child in _seen');
  
  t.end();
});

tap.test('propagateTokenCostsToRootSpan - multi-level tree propagation', async t => {
  const grandchild = createTestSpan('grandchild', 'grandchild-span', 'child', {
    inputTokens: 50,
    outputTokens: 25,
    cost: 0.0005
  });
  
  const child = createTestSpan('child', 'child-span', 'parent', {
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.001
  });
  
  const parent = createTestSpan('parent', 'parent-span', undefined, {
    inputTokens: 10,
    outputTokens: 5,
    cost: 0.0001
  });
  
  const spans = [grandchild, child, parent];
  
  await propagateTokenCostsToRootSpan(spans);
  
  // Child should have grandchild's tokens
  const childUsage = getTokenUsage(child);
  t.equal(childUsage.inputTokens, 150); // 100 + 50
  t.equal(childUsage.outputTokens, 75); // 50 + 25
  
  // Parent should have all tokens
  const parentUsage = getTokenUsage(parent);
  t.equal(parentUsage.inputTokens, 160); // 10 + 100 + 50
  t.equal(parentUsage.outputTokens, 80); // 5 + 50 + 25
  t.ok(Math.abs(parentUsage.cost - 0.0016) < 0.000001, 'cost should be approximately 0.0016'); // 0.0001 + 0.001 + 0.0005
  
  t.end();
});

tap.test('propagateTokenCostsToRootSpan - loads missing parent from database', async t => {
  const child = createTestSpan('child', 'child-span', 'parent', {
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.001
  });
  
  const parent = createTestSpan('parent', 'parent-span', undefined, {
    inputTokens: 10,
    outputTokens: 5,
    cost: 0.0001
  });
  
  // Only child is in batch, parent should be loaded
  const spans = [child];
  
  let loadedParentId: string | null = null;
  const mockDeps: PropagateTokenCostsDependencies = {
    searchSpans: async (query, org, limit, offset) => {
      const queryStr = typeof query === 'string' ? query : (query as any).query || '';
      if (queryStr.includes('id:parent')) {
        loadedParentId = 'parent';
        return { hits: [parent], total: 1 };
      }
      return { hits: [], total: 0 };
    },
    updateSpan: async (spanId, updates, org) => {
      t.equal(spanId, 'parent', 'should update loaded parent');
      t.ok(updates.attributes, 'should include attributes');
      return { ...parent, ...updates } as Span;
    }
  };
  
  await propagateTokenCostsToRootSpan(spans, mockDeps);
  
  t.equal(loadedParentId, 'parent', 'should have loaded parent');
  
  // Child should have its own tokens (parent was loaded separately)
  const childUsage = getTokenUsage(child);
  t.equal(childUsage.inputTokens, 100);
  t.equal(childUsage.outputTokens, 50);
  
  t.end();
});

tap.test('propagateTokenCostsToRootSpan - idempotent updates with _seen', async t => {
  const child = createTestSpan('child', 'child-span', 'parent', {
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.001
  });
  
  const parent = createTestSpan('parent', 'parent-span', undefined, {
    inputTokens: 10,
    outputTokens: 5,
    cost: 0.0001
  });
  
  // Mark child as already seen
  (parent as any)._seen = [spanIdToHash('child')!];
  
  const spans = [child, parent];
  
  await propagateTokenCostsToRootSpan(spans);
  
  // Parent should NOT have child's tokens (already processed)
  const parentUsage = getTokenUsage(parent);
  t.equal(parentUsage.inputTokens, 10, 'should not add child tokens if already seen');
  t.equal(parentUsage.outputTokens, 5, 'should not add child tokens if already seen');
  
  t.end();
});

tap.test('propagateTokenCostsToRootSpan - multiple children', async t => {
  const child1 = createTestSpan('child1', 'child1-span', 'parent', {
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.001
  });
  
  const child2 = createTestSpan('child2', 'child2-span', 'parent', {
    inputTokens: 200,
    outputTokens: 100,
    cost: 0.002
  });
  
  const parent = createTestSpan('parent', 'parent-span', undefined, {
    inputTokens: 10,
    outputTokens: 5,
    cost: 0.0001
  });
  
  const spans = [child1, child2, parent];
  
  await propagateTokenCostsToRootSpan(spans);
  
  const parentUsage = getTokenUsage(parent);
  t.equal(parentUsage.inputTokens, 310); // 10 + 100 + 200
  t.equal(parentUsage.outputTokens, 155); // 5 + 50 + 100
  t.ok(Math.abs(parentUsage.cost - 0.0031) < 0.000001, 'cost should be approximately 0.0031'); // 0.0001 + 0.001 + 0.002
  
  // Parent should have both children in _seen
  const seenSet = new Set((parent as any)._seen);
  t.ok(seenSet.has(spanIdToHash('child1')!), 'should have child1 in _seen');
  t.ok(seenSet.has(spanIdToHash('child2')!), 'should have child2 in _seen');
  
  t.end();
});

tap.test('propagateTokenCostsToRootSpan - empty spans array', async t => {
  await propagateTokenCostsToRootSpan([]);
  t.pass('should handle empty array');
  t.end();
});

tap.test('propagateTokenCostsToRootSpan - span without organisation', async t => {
  const span = createTestSpan('span1', 'test');
  delete (span as any).organisation;
  
  await propagateTokenCostsToRootSpan([span]);
  t.pass('should handle missing organisation gracefully');
  t.end();
});

tap.test('propagateTokenCostsToRootSpan - span without id', async t => {
  const span = createTestSpan('span1', 'test');
  delete (span as any).id;
  
  await propagateTokenCostsToRootSpan([span]);
  t.pass('should handle missing id gracefully');
  t.end();
});

tap.test('propagateTokenCostsToRootSpan - multiple root spans', async t => {
  const root1 = createTestSpan('root1', 'root1-span', undefined, {
    inputTokens: 10,
    outputTokens: 5,
    cost: 0.0001
  });
  
  const root2 = createTestSpan('root2', 'root2-span', undefined, {
    inputTokens: 20,
    outputTokens: 10,
    cost: 0.0002
  });
  
  const child1 = createTestSpan('child1', 'child1-span', 'root1', {
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.001
  });
  
  const child2 = createTestSpan('child2', 'child2-span', 'root2', {
    inputTokens: 200,
    outputTokens: 100,
    cost: 0.002
  });
  
  const spans = [root1, root2, child1, child2];
  
  await propagateTokenCostsToRootSpan(spans);
  
  const root1Usage = getTokenUsage(root1);
  t.equal(root1Usage.inputTokens, 110); // 10 + 100
  t.equal(root1Usage.outputTokens, 55); // 5 + 50
  
  const root2Usage = getTokenUsage(root2);
  t.equal(root2Usage.inputTokens, 220); // 20 + 200
  t.equal(root2Usage.outputTokens, 110); // 10 + 100
  
  t.end();
});

tap.test('propagateTokenCostsToRootSpan - handles database errors gracefully', async t => {
  const child = createTestSpan('child', 'child-span', 'parent', {
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.001
  });
  
  const mockDeps: PropagateTokenCostsDependencies = {
    searchSpans: async () => {
      throw new Error('Database error');
    },
    updateSpan: async () => {
      throw new Error('Update error');
    }
  };
  
  // Should not throw
  await propagateTokenCostsToRootSpan([child], mockDeps);
  
  // Child should still have its tokens
  const childUsage = getTokenUsage(child);
  t.equal(childUsage.inputTokens, 100);
  
  t.end();
});

tap.test('propagateTokenCostsToRootSpan - recursive parent loading', async t => {
  const child = createTestSpan('child', 'child-span', 'parent', {
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.001
  });
  
  const parent = createTestSpan('parent', 'parent-span', 'grandparent', {
    inputTokens: 10,
    outputTokens: 5,
    cost: 0.0001
  });
  
  const grandparent = createTestSpan('grandparent', 'grandparent-span', undefined, {
    inputTokens: 5,
    outputTokens: 2,
    cost: 0.00005
  });
  
  const spans = [child];
  
  const loadedIds: string[] = [];
  const mockDeps: PropagateTokenCostsDependencies = {
    searchSpans: async (query, org, limit, offset) => {
      const queryStr = typeof query === 'string' ? query : (query as any).query || '';
      if (queryStr.includes('id:parent')) {
        loadedIds.push('parent');
        return { hits: [parent], total: 1 };
      }
      if (queryStr.includes('id:grandparent')) {
        loadedIds.push('grandparent');
        return { hits: [grandparent], total: 1 };
      }
      return { hits: [], total: 0 };
    },
    updateSpan: async (spanId, updates, org) => {
      return null; // Don't care about updates for this test
    }
  };
  
  await propagateTokenCostsToRootSpan(spans, mockDeps);
  
  t.ok(loadedIds.includes('parent'), 'should load parent');
  t.ok(loadedIds.includes('grandparent'), 'should load grandparent recursively');
  
  t.end();
});

