import { Span } from '../common/types';

/** Extract string(s) from a single message-like value: string, or object with content/text/message. */
function messageToText(msg: unknown): string[] {
  if (msg == null) return [];
  if (typeof msg === 'string') return msg.trim() ? [msg.trim()] : [];
  if (typeof msg !== 'object') return [];
  const obj = msg as Record<string, unknown>;
  const content = obj.content ?? obj.text ?? obj.message;
  if (typeof content === 'string') return content.trim() ? [content.trim()] : [];
  if (Array.isArray(content)) return content.filter((c): c is string => typeof c === 'string').map((s) => s.trim()).filter(Boolean);
  return [];
}

/** Normalize value (string, string[], or object/array with content) to string[]. */
function valueToTexts(val: unknown): string[] {
  if (val == null) return [];
  if (Array.isArray(val)) return val.flatMap((m) => messageToText(m));
  return messageToText(val);
}

/** Get attribute by flat key or nested path (e.g. attrs['gen_ai.input.messages'] or attrs.gen_ai?.input?.messages). */
function getAttr(attrs: Record<string, unknown>, flatKey: string, ...nestedKeys: string[]): unknown {
  const flat = attrs[flatKey];
  if (flat !== undefined && flat !== null) return flat;
  let cur: unknown = attrs;
  for (const k of nestedKeys) {
    cur = (cur as Record<string, unknown>)?.[k];
    if (cur === undefined) return undefined;
  }
  return cur;
}

const MESSAGE_ATTR_PATHS: [flatKey: string, ...nested: string[]][] = [
  ['gen_ai.input.messages', 'gen_ai', 'input', 'messages'],
  ['input.messages', 'input', 'messages'],
  ['input.message', 'input', 'message'],
];

/** Union of attribute paths: gen_ai.input.messages, input.messages, input.message (nested or flat keys). */
function getMessageTextsFromSpan(span: Span): string[] {
  const attrs = (span as { attributes?: Record<string, unknown> }).attributes ?? {};
  return MESSAGE_ATTR_PATHS.flatMap(([flatKey, ...nested]) =>
    valueToTexts(getAttr(attrs, flatKey, ...nested))
  );
}

/** All message text strings from the union of attributes.gen_ai.input.messages, attributes.input.messages, attributes.input.message across spans. */
export function extractMessageTextsFromSpans(spans: Span[]): string[] {
  const texts: string[] = [];
  spans.forEach((span) => texts.push(...getMessageTextsFromSpan(span)));
  return texts;
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'were', 'will', 'with',
]);

/** Tokenize and count words; returns entries sorted by count descending. Min length 2, lowercase, no stopwords. */
export function getWordCounts(texts: string[], maxWords = 80): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  const re = /\b[a-z]{2,}\b/gi;
  texts.forEach((s) => {
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(s)) !== null) {
      const w = m[0].toLowerCase();
      if (!STOPWORDS.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  });
  return Array.from(counts.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, maxWords);
}
