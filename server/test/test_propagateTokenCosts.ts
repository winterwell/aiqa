import tap from 'tap';
import Span from '../dist/common/types/Span.js';
import {
  propagateTokenCostsToRootSpan,
  getSpanStatsFromAttributes,
  TokenStats,
  PropagateTokenCostsDependencies,
} from '../dist/routes/server-span-utils.js';
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
  
  const now = Date.now();
  return {
    id,
    name,
    trace: 'test-trace',
    organisation,
    kind: 1,
    start: now,
    end: now + 100,
    duration: 100,
    ended: true,
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
    ...(parentId && { parent: parentId }),
  };
}

tap.test('getSpanStatsFromAttributes - extracts token usage from span attributes', t => {
  const span = createTestSpan('span1', 'test', undefined, {
    inputTokens: 100,
    outputTokens: 50,
    cachedInputTokens: 10,
    totalTokens: 150,
    cost: 0.001
  });
  
  const usage = getSpanStatsFromAttributes(span);
  t.equal(usage.inputTokens, 100);
  t.equal(usage.outputTokens, 50);
  t.equal(usage.cachedInputTokens, 10);
  t.equal(usage.totalTokens, 150);
  t.equal(usage.cost, 0.001);
  t.end();
});

tap.test('getSpanStatsFromAttributes - returns zeros for span without token usage', t => {
  const span = createTestSpan('span1', 'test');
  const usage = getSpanStatsFromAttributes(span);
  t.equal(usage.inputTokens, 0);
  t.equal(usage.outputTokens, 0);
  t.equal(usage.cachedInputTokens, 0);
  t.equal(usage.totalTokens, 0);
  t.equal(usage.cost, 0);
  t.end();
});

tap.test('propagateTokenCostsToRootSpan - sets stats on leaf span', async t => {
  const span = createTestSpan('span1', 'test', undefined, {
    inputTokens: 10,
    outputTokens: 5,
    cachedInputTokens: 5,
    totalTokens: 20,
    cost: 0.0002
  });

  await propagateTokenCostsToRootSpan([span]);

  t.equal(span.stats?.inputTokens, 10);
  t.equal(span.stats?.outputTokens, 5);
  t.equal(span.stats?.cachedInputTokens, 5);
  t.equal(span.stats?.totalTokens, 20);
  t.ok(Math.abs((span.stats?.cost ?? 0) - 0.0002) < 0.000001, 'cost should be approximately 0.0002');
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
  t.equal(parent.stats?.inputTokens, 110); // 10 + 100
  t.equal(parent.stats?.outputTokens, 55); // 5 + 50
  t.equal(parent.stats?.cost, 0.0011); // 0.0001 + 0.001
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
  t.equal(child.stats?.inputTokens, 150); // 100 + 50
  t.equal(child.stats?.outputTokens, 75); // 50 + 25
  
  // Parent should have all tokens
  t.equal(parent.stats?.inputTokens, 160); // 10 + 100 + 50
  t.equal(parent.stats?.outputTokens, 80); // 5 + 50 + 25
  t.ok(Math.abs((parent.stats?.cost ?? 0) - 0.0016) < 0.000001, 'cost should be approximately 0.0016'); // 0.0001 + 0.001 + 0.0005
  
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
      t.ok(updates.stats, 'should include stats');
      return { ...parent, ...updates } as Span;
    }
  };
  
  await propagateTokenCostsToRootSpan(spans, mockDeps);
  
  t.equal(loadedParentId, 'parent', 'should have loaded parent');
  
  // Child should have its own tokens (parent was loaded separately)
  t.equal(child.stats?.inputTokens, 100);
  t.equal(child.stats?.outputTokens, 50);
  
  t.end();
});

tap.test('propagateTokenCostsToRootSpan - parent always set to own + sum(children)', async t => {
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

  t.equal(parent.stats?.inputTokens, 110, 'parent = own + child');
  t.equal(parent.stats?.outputTokens, 55, 'parent = own + child');
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
  
  t.equal(parent.stats?.inputTokens, 310); // 10 + 100 + 200
  t.equal(parent.stats?.outputTokens, 155); // 5 + 50 + 100
  t.ok(Math.abs((parent.stats?.cost ?? 0) - 0.0031) < 0.000001, 'cost should be approximately 0.0031'); // 0.0001 + 0.001 + 0.002
  t.end();
});

tap.test('propagateTokenCostsToRootSpan - late-arriving batch does not lose earlier counts', async t => {
  const child1 = createTestSpan('child1', 'child1-span', 'parent', {
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    cost: 0.001
  });
  const child2 = createTestSpan('child2', 'child2-span', 'parent', {
    inputTokens: 200,
    outputTokens: 100,
    totalTokens: 300,
    cost: 0.002
  });
  const parent = createTestSpan('parent', 'parent-span', undefined, {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    cost: 0.0001
  });
  await propagateTokenCostsToRootSpan([child1, parent]);
  t.equal(parent.stats?.inputTokens, 110, 'after batch 1: parent = 10 + 100');
  t.equal(parent.stats?.totalTokens, 165, 'after batch 1: total 15 + 150');

  const mockDeps: PropagateTokenCostsDependencies = {
    searchSpans: async (_query, _org, _limit, _offset) => ({
      hits: [{
        ...parent,
        stats: {
          ...parent.stats,
          inputTokens: 110,
          outputTokens: 55,
          totalTokens: 165,
          cost: 0.0011
        }
      }],
      total: 1
    }),
    updateSpan: async (_id, updates) => {
      Object.assign(parent, updates ?? {});
      return parent as Span;
    }
  };
  await propagateTokenCostsToRootSpan([child2], mockDeps);
  t.equal(parent.stats?.inputTokens, 310, 'after late-arriving batch 2: parent = 110 + 200 (earlier counts kept)');
  t.equal(parent.stats?.outputTokens, 155, 'after batch 2: output 55 + 100');
  t.equal(parent.stats?.totalTokens, 465, 'after batch 2: total 165 + 300');
  t.ok(Math.abs((parent.stats?.cost ?? 0) - 0.0031) < 0.000001, 'cost = 0.0011 + 0.002');
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

  await t.rejects(
    () => propagateTokenCostsToRootSpan([span]),
    /propagateTokenCostsToRootSpan: span missing id/,
    'should throw when span has no id'
  );
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
  
  t.equal(root1.stats?.inputTokens, 110); // 10 + 100
  t.equal(root1.stats?.outputTokens, 55); // 5 + 50
  
  t.equal(root2.stats?.inputTokens, 220); // 20 + 200
  t.equal(root2.stats?.outputTokens, 110); // 10 + 100
  
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
  t.equal(child.stats?.inputTokens, 100);
  
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
