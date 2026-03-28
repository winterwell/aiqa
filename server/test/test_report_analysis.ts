import tap from 'tap';
import {
  deterministicEmbedding,
  monthBucketKey,
  normaliseReportParams,
  serialiseForEmbedding,
  textForExample,
  textForSpan,
} from '../dist/analysis/report_analysis.js';
import type Example from '../dist/common/types/Example.js';
import type Span from '../dist/common/types/Span.js';

tap.test('deterministicEmbedding is stable and normalised', async (t) => {
  const a = deterministicEmbedding('hello', 16);
  const b = deterministicEmbedding('hello', 16);
  t.same(a, b);
  const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  t.ok(Math.abs(norm - 1) < 1e-6);
});

tap.test('monthBucketKey UTC', async (t) => {
  t.equal(monthBucketKey(Date.UTC(2026, 0, 15)), '2026-01');
});

tap.test('normaliseReportParams', async (t) => {
  const p = normaliseReportParams('coverage', { clusterCount: 3, pcaDimensions: 5 });
  t.equal(p.clusterCount, 3);
  t.equal(p.pcaDimensions, 5);
});

tap.test('feature text helpers', async (t) => {
  const ex = { id: '1', dataset: 'd', organisation: 'o', input: { q: 1 }, created: new Date(), updated: new Date() } as Example;
  t.ok(textForExample(ex, 'example_input').includes('q'));
  const sp = {
    id: 's',
    trace: 't',
    organisation: 'o',
    start: 0,
    end: 1,
    attributes: { input: 'hi', output: 'bye' },
  } as unknown as Span;
  t.equal(textForSpan(sp, 'span_input'), serialiseForEmbedding('hi'));
});
