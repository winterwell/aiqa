import { describe, it, expect } from 'vitest';
import { extractMessageTextsFromSpans, getWordCounts } from './wordcloud-utils';
import { Span } from '../common/types';

function mockSpan(attributes: Record<string, unknown>): Span {
  return {
    id: '1',
    traceId: 't1',
    name: 'test',
    startTime: 0,
    endTime: 0,
    attributes: attributes as any,
    organisation: 'org',
    starred: false,
  } as Span;
}

describe('wordcloud-utils', () => {
  describe('extractMessageTextsFromSpans', () => {
    it('extracts from attributes.gen_ai.input.messages', () => {
      const spans = [
        mockSpan({
          'gen_ai': {
            input: {
              messages: [
                { role: 'user', content: 'Hello world' },
                { content: 'Another message' },
              ],
            },
          },
        }),
      ];
      expect(extractMessageTextsFromSpans(spans)).toEqual(['Hello world', 'Another message']);
    });

    it('extracts from attributes.input.messages and attributes.input.message', () => {
      const spans = [
        mockSpan({
          input: {
            messages: [{ content: 'Foo bar' }],
            message: 'Single message',
          },
        }),
      ];
      const out = extractMessageTextsFromSpans(spans);
      expect(out).toContain('Foo bar');
      expect(out).toContain('Single message');
    });

    it('extracts from flat dotted keys', () => {
      const spans = [
        mockSpan({
          'gen_ai.input.messages': [{ content: 'Flat gen_ai' }],
          'input.messages': [{ content: 'Flat input' }],
          'input.message': 'Single flat',
        }),
      ];
      const out = extractMessageTextsFromSpans(spans);
      expect(out).toContain('Flat gen_ai');
      expect(out).toContain('Flat input');
      expect(out).toContain('Single flat');
    });

    it('returns empty for span with no message attributes', () => {
      expect(extractMessageTextsFromSpans([mockSpan({})])).toEqual([]);
    });
  });

  describe('getWordCounts', () => {
    it('counts words, lowercases, filters stopwords and short words', () => {
      const counts = getWordCounts(['The quick brown fox', 'quick and the lazy fox'], 20);
      expect(counts.find((c) => c.word === 'quick')?.count).toBe(2);
      expect(counts.find((c) => c.word === 'fox')?.count).toBe(2);
      expect(counts.find((c) => c.word === 'the')).toBeUndefined();
      expect(counts.find((c) => c.word === 'and')).toBeUndefined();
    });

    it('returns at most maxWords', () => {
      const long = Array(200)
        .fill('word')
        .map((w, i) => w + i)
        .join(' ');
      const counts = getWordCounts([long], 10);
      expect(counts.length).toBeLessThanOrEqual(10);
    });
  });
});
