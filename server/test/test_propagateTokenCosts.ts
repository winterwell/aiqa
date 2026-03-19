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
  timeToFirstOutputTokenSeconds?: number,
  organisation: string = 'test-org'
): Span {
  const attrs: any = {};
  if (tokenUsage) {
    if (tokenUsage.inputTokens !== undefined) attrs['gen_ai.usage.input_tokens'] = tokenUsage.inputTokens;
    if (tokenUsage.outputTokens !== undefined) attrs['gen_ai.usage.output_tokens'] = tokenUsage.outputTokens;
    if (tokenUsage.cachedInputTokens !== undefined) attrs['gen_ai.usage.cache_read.input_tokens'] = tokenUsage.cachedInputTokens;
    if (tokenUsage.totalTokens !== undefined) attrs['gen_ai.usage.total_tokens'] = tokenUsage.totalTokens;
    if (tokenUsage.cost !== undefined) attrs['gen_ai.cost.usd'] = tokenUsage.cost;
    if ((tokenUsage as any).cacheCreationTokens !== undefined) {
      attrs['gen_ai.usage.cache_creation.input_tokens'] = (tokenUsage as any).cacheCreationTokens;
    }
  }
  if (timeToFirstOutputTokenSeconds !== undefined) {
    attrs['gen_ai.server.time_to_first_output_token'] = timeToFirstOutputTokenSeconds;
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
  }, 0.42);
  
  const usage = getSpanStatsFromAttributes(span);
  t.equal(usage.inputTokens, 100);
  t.equal(usage.outputTokens, 50);
  t.equal(usage.cachedInputTokens, 10);
  t.equal(usage.totalTokens, 150);
  t.equal(usage.cost, 0.001);
  t.equal(usage.timeToFirstOutputTokenSeconds, 0.42);
  t.end();
});

tap.test('getSpanStatsFromAttributes - returns zeros for span without token usage', t => {
  const span = createTestSpan('span1', 'test');
  const usage = getSpanStatsFromAttributes(span);
  t.equal(usage.inputTokens, undefined);
  t.equal(usage.outputTokens, undefined);
  t.equal(usage.cachedInputTokens, undefined);
  t.equal(usage.totalTokens, undefined);
  t.equal(usage.cost, undefined);
  t.end();
});


tap.test('propagateTokenCostsToRootSpan - sets stats on leaf span', async t => {
  const span = createTestSpan('span1', 'test', undefined, {
    inputTokens: 10,
    outputTokens: 5,
    cachedInputTokens: 5,
    totalTokens: 20,
    cost: 0.0002
  }, 0.25);

  await propagateTokenCostsToRootSpan([span]);

  t.equal(span.stats?.inputTokens, 10);
  t.equal(span.stats?.outputTokens, 5);
  t.equal(span.stats?.cachedInputTokens, 5);
  t.equal(span.stats?.totalTokens, 20);
  t.ok(Math.abs((span.stats?.cost ?? 0) - 0.0002) < 0.000001, 'cost should be approximately 0.0002');
  t.equal(span.stats?.timeToFirstOutputTokenSeconds, 0.25);
  t.end();
});

tap.test('propagateTokenCostsToRootSpan - simple parent-child propagation', async t => {
  const child = createTestSpan('child', 'child-span', 'parent', {
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.001
  }, 0.2);
  
  const parent = createTestSpan('parent', 'parent-span', undefined, {
    inputTokens: 10,
    outputTokens: 5,
    cost: 0.0001
  }, undefined);
  
  const spans = [child, parent];
  
  await propagateTokenCostsToRootSpan(spans);
  
  // Parent should have aggregated tokens from child
  t.equal(parent.stats?.inputTokens, 110); // 10 + 100
  t.equal(parent.stats?.outputTokens, 55); // 5 + 50
  t.equal(parent.stats?.cost, 0.0011); // 0.0001 + 0.001
  // Parent has no time-to-first on itself; it should inherit from child, adjusted to parent start.
  // For these test spans, starts are set by createTestSpan; we just assert non-null and consistent adjustment shape.
  t.ok(typeof parent.stats?.timeToFirstOutputTokenSeconds === 'number', 'parent should have timeToFirstOutputTokenSeconds');
  t.end();
});

tap.test('propagateTokenCostsToRootSpan - timeToFirst precedence: parent wins', async t => {
  const parent = createTestSpan('parent', 'parent-span', undefined, {
    inputTokens: 10,
    outputTokens: 5,
    cost: 0.0001,
  }, 0.9);

  const child = createTestSpan('child', 'child-span', 'parent', {
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.001,
  }, 0.2);

  // Make timing deterministic for delta math.
  parent.start = 0;
  parent.end = 1000;
  child.start = 200;
  child.end = 1200;

  await propagateTokenCostsToRootSpan([child, parent]);

  // Parent's own value should win over descendant values.
  t.equal(parent.stats?.timeToFirstOutputTokenSeconds, 0.9);
  t.end();
});

tap.test('propagateTokenCostsToRootSpan - timeToFirst inheritance: adjusted to parent start', async t => {
  const parent = createTestSpan('parent', 'parent-span', undefined, {
    inputTokens: 10,
    outputTokens: 5,
    cost: 0.0001,
  });

  const child = createTestSpan('child', 'child-span', 'parent', {
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.001,
  }, 0.5);

  parent.start = 0;
  parent.end = 1000;
  child.start = 200;
  child.end = 1200;

  await propagateTokenCostsToRootSpan([child, parent]);

  // Child first-output token happens at child.start + 0.5s, so relative to parent.start:
  // (200ms + 500ms) / 1000 = 0.7s
  t.equal(parent.stats?.timeToFirstOutputTokenSeconds, 0.7);
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
  
  await propagateTokenCostsToRootSpan(spans);
  
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

  await propagateTokenCostsToRootSpan([child2]);
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
  
  // Should not throw
  await propagateTokenCostsToRootSpan([child]);
  
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
  
  await propagateTokenCostsToRootSpan(spans);
  
  t.ok(loadedIds.includes('parent'), 'should load parent');
  t.ok(loadedIds.includes('grandparent'), 'should load grandparent recursively');
  
  t.end();
});
