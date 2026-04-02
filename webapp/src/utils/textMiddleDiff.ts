/** Collapse runs of common whitespace to a single space (Perl-style `s/[ \n\t]+/ /g`, plus `\r` for CRLF). */
export function compactWhitespace(s: string): string {
  return s.replace(/[ \n\t\r]+/g, ' ');
}

/**
 * Longest case-insensitive prefix match, then longest case-insensitive suffix match
 * on the remainders. Used to show a compact “middle differs” diff.
 */
export function splitMiddleDiffCaseInsensitive(a: string, b: string): {
  pre: number;
  suf: number;
} {
  const na = a.length;
  const nb = b.length;
  let i = 0;
  while (i < na && i < nb && a[i]!.toLowerCase() === b[i]!.toLowerCase()) {
    i++;
  }
  let j = 0;
  while (j < na - i && j < nb - i) {
    const ca = a[na - 1 - j]!;
    const cb = b[nb - 1 - j]!;
    if (ca.toLowerCase() !== cb.toLowerCase()) break;
    j++;
  }
  return { pre: i, suf: j };
}

/** True when both sides are empty or equal ignoring ASCII case. */
export function samePairTextFold(a: string, b: string): boolean {
  if (a === b) return true;
  return a.toLowerCase() === b.toLowerCase();
}

/** Unicode ellipsis for “truncated before this point”. */
export const DIFF_TRUNCATION_ELLIPSIS = '\u2026';

/** Default max characters (both lines) for pair diff cells in tables. */
export const PAIR_DIFF_DISPLAY_MAX_CHARS = 480;

function tailPrefix(pref: string, maxTailChars: number): string {
  if (!pref) return '';
  if (pref.length <= maxTailChars) return pref;
  if (maxTailChars <= 0) return DIFF_TRUNCATION_ELLIPSIS;
  return DIFF_TRUNCATION_ELLIPSIS + pref.slice(-maxTailChars);
}

function tailSegment(seg: string, maxTailChars: number): string {
  if (!seg) return '';
  if (seg.length <= maxTailChars) return seg;
  if (maxTailChars <= 0) return DIFF_TRUNCATION_ELLIPSIS;
  return DIFF_TRUNCATION_ELLIPSIS + seg.slice(-maxTailChars);
}

export type PairDiffParts = {
  prefA: string;
  prefB: string;
  midA: string;
  sufA: string;
  midB: string;
  sufB: string;
};

/**
 * Fits a two-line prefix/mid/suffix diff into `maxTotalChars` by trimming the **equal prefix from the left**
 * first (keeping the tail of the prefix next to the diff), then trimming mids and suffixes from the left if needed.
 */
export function shrinkPairDiffForDisplay(parts: PairDiffParts, maxTotalChars: number): PairDiffParts {
  const { prefA, prefB, midA: mA0, sufA: sA0, midB: mB0, sufB: sB0 } = parts;
  const preLen = prefA.length;

  const len = (prefTail: number, midTail: number, sufTail: number): number => {
    const pA = tailPrefix(prefA, prefTail);
    const pB = tailPrefix(prefB, prefTail);
    const ma = tailSegment(mA0, midTail);
    const mb = tailSegment(mB0, midTail);
    const sa = tailSegment(sA0, sufTail);
    const sb = tailSegment(sB0, sufTail);
    return pA.length + ma.length + sa.length + pB.length + mb.length + sb.length;
  };

  // 1) Maximize visible tail of the equal prefix (drop equal characters from the start first).
  let lo = 0;
  let hi = preLen;
  let bestPref = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const maxMid = Math.max(mA0.length, mB0.length);
    const maxSuf = Math.max(sA0.length, sB0.length);
    if (len(mid, maxMid, maxSuf) <= maxTotalChars) {
      bestPref = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  let midTail = Math.max(mA0.length, mB0.length);
  let sufTail = Math.max(sA0.length, sB0.length);
  if (len(bestPref, midTail, sufTail) <= maxTotalChars) {
    return {
      prefA: tailPrefix(prefA, bestPref),
      prefB: tailPrefix(prefB, bestPref),
      midA: mA0,
      sufA: sA0,
      midB: mB0,
      sufB: sB0,
    };
  }

  // 2) Shrink middles (keep tail — nearest to suffix / differing region).
  lo = 0;
  hi = Math.max(mA0.length, mB0.length);
  let bestMid = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (len(bestPref, mid, sufTail) <= maxTotalChars) {
      bestMid = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  midTail = bestMid;

  if (len(bestPref, midTail, sufTail) <= maxTotalChars) {
    return {
      prefA: tailPrefix(prefA, bestPref),
      prefB: tailPrefix(prefB, bestPref),
      midA: tailSegment(mA0, midTail),
      sufA: sA0,
      midB: tailSegment(mB0, midTail),
      sufB: sB0,
    };
  }

  // 3) Shrink suffixes (same: keep tail).
  lo = 0;
  hi = Math.max(sA0.length, sB0.length);
  let bestSuf = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (len(bestPref, midTail, mid) <= maxTotalChars) {
      bestSuf = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  sufTail = bestSuf;

  return {
    prefA: tailPrefix(prefA, bestPref),
    prefB: tailPrefix(prefB, bestPref),
    midA: tailSegment(mA0, midTail),
    sufA: tailSegment(sA0, sufTail),
    midB: tailSegment(mB0, midTail),
    sufB: tailSegment(sB0, sufTail),
  };
}
