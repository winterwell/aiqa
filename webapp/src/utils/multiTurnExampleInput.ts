/**
 * Micro-format for multi-turn example input (string {@link Example.input}):
 * <user>…</user> and <assistant>…</assistant> segments only, in order.
 * Whole value must be tag-balanced; no leading plain text outside tags.
 */

export type MultiTurnRole = 'user' | 'assistant';

export type MultiTurnTurn = { role: MultiTurnRole; content: string };

const OPEN_RE = /^<(user|assistant)>/;

/**
 * Parse a string into turns if it fully matches the tag sequence; otherwise null (treat as plain text).
 * Closing tag is chosen to match the opening role. First non-whitespace must start a tag if any turns exist.
 */
export function parseMultiTurnTaggedInput(text: string): MultiTurnTurn[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  let pos = 0;
  const turns: MultiTurnTurn[] = [];

  while (pos < trimmed.length) {
    while (pos < trimmed.length && /\s/.test(trimmed[pos])) {
      pos++;
    }
    if (pos >= trimmed.length) break;

    const slice = trimmed.slice(pos);
    const openMatch = slice.match(OPEN_RE);
    if (!openMatch) {
      return null;
    }

    const role = openMatch[1] as MultiTurnRole;
    pos += openMatch[0].length;
    const close = `</${role}>`;
    const end = trimmed.indexOf(close, pos);
    if (end === -1) return null;

    turns.push({ role, content: trimmed.slice(pos, end) });
    pos = end + close.length;
  }

  return turns.length > 0 ? turns : null;
}

export function serializeMultiTurnTaggedInput(turns: MultiTurnTurn[]): string {
  return turns.map((t) => `<${t.role}>${t.content}</${t.role}>`).join('\n\n');
}

export function isMultiTurnTaggedInputString(text: string): boolean {
  return parseMultiTurnTaggedInput(text) !== null;
}

/** Table / tooltip-friendly line without raw angle brackets. */
export function formatMultiTurnForCompactDisplay(text: string, maxLength: number): string {
  const turns = parseMultiTurnTaggedInput(text);
  if (!turns) return text;

  const label = (r: MultiTurnRole) => (r === 'user' ? 'User' : 'Asst');
  const parts = turns.map((t) => `${label(t.role)}: ${t.content.trim().replace(/\s+/g, ' ')}`);
  let s = parts.join(' · ');
  if (s.length <= maxLength) return s;
  return s.slice(0, Math.max(0, maxLength - 3)) + '...';
}
