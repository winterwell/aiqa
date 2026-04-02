import { describe, expect, it } from 'vitest';
import {
  compactWhitespace,
  DIFF_TRUNCATION_ELLIPSIS,
  PAIR_DIFF_DISPLAY_MAX_CHARS,
  samePairTextFold,
  shrinkPairDiffForDisplay,
  splitMiddleDiffCaseInsensitive,
} from '../../src/utils/textMiddleDiff';

describe('compactWhitespace', () => {
  it('collapses spaces tabs newlines to single space', () => {
    expect(compactWhitespace('a  b')).toBe('a b');
    expect(compactWhitespace('a\n\tb')).toBe('a b');
    expect(compactWhitespace('a\r\nb')).toBe('a b');
    expect(compactWhitespace('  x  \n  y  ')).toBe(' x y ');
  });
});

describe('splitMiddleDiffCaseInsensitive', () => {
  it('whole string matches when only case differs', () => {
    const { pre, suf } = splitMiddleDiffCaseInsensitive('Hello', 'hello');
    expect(pre).toBe(5);
    expect(suf).toBe(0);
  });

  it('splits middle when start and end match', () => {
    const { pre, suf } = splitMiddleDiffCaseInsensitive('abcXdef', 'abcYdef');
    expect(pre).toBe(3);
    expect(suf).toBe(3);
  });

  it('handles extra chars on one side', () => {
    const { pre, suf } = splitMiddleDiffCaseInsensitive('ax', 'aax');
    expect(pre).toBe(1);
    expect(suf).toBe(1);
  });
});

describe('samePairTextFold', () => {
  it('treats case variants as same', () => {
    expect(samePairTextFold('Ab', 'ab')).toBe(true);
  });
});

describe('shrinkPairDiffForDisplay', () => {
  it('keeps short diffs unchanged', () => {
    const o = shrinkPairDiffForDisplay(
      {
        prefA: 'ab',
        prefB: 'ab',
        midA: 'X',
        midB: 'Y',
        sufA: 'z',
        sufB: 'z',
      },
      PAIR_DIFF_DISPLAY_MAX_CHARS,
    );
    expect(o.prefA).toBe('ab');
    expect(o.midA).toBe('X');
  });

  it('drops equal prefix from the left so differing middles stay visible', () => {
    const pad = 'a'.repeat(4000);
    const o = shrinkPairDiffForDisplay(
      {
        prefA: pad,
        prefB: pad,
        midA: 'DIFFA',
        midB: 'DIFFB',
        sufA: 'z',
        sufB: 'z',
      },
      200,
    );
    expect(o.prefA.startsWith(DIFF_TRUNCATION_ELLIPSIS)).toBe(true);
    const total =
      o.prefA.length +
      o.midA.length +
      o.sufA.length +
      o.prefB.length +
      o.midB.length +
      o.sufB.length;
    expect(total).toBeLessThanOrEqual(200);
    expect(o.midA).toContain('DIFFA');
    expect(o.midB).toContain('DIFFB');
  });
});
