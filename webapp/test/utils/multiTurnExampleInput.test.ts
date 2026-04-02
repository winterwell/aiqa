import { describe, it, expect } from 'vitest';
import {
  formatMultiTurnForCompactDisplay,
  isMultiTurnTaggedInputString,
  parseMultiTurnTaggedInput,
  serializeMultiTurnTaggedInput,
} from '../../src/utils/multiTurnExampleInput';

describe('multiTurnExampleInput', () => {
  const sample =
    '<user>input 1</user>\n\n<assistant>optional response 1 notes</assistant>\n\n<user>input 2</user>';

  it('parses multi-turn tag sequence', () => {
    const turns = parseMultiTurnTaggedInput(sample);
    expect(turns).toEqual([
      { role: 'user', content: 'input 1' },
      { role: 'assistant', content: 'optional response 1 notes' },
      { role: 'user', content: 'input 2' },
    ]);
  });

  it('round-trips through serialize', () => {
    const turns = parseMultiTurnTaggedInput(sample)!;
    const again = parseMultiTurnTaggedInput(serializeMultiTurnTaggedInput(turns));
    expect(again).toEqual(turns);
  });

  it('returns null for plain text', () => {
    expect(parseMultiTurnTaggedInput('hello')).toBeNull();
    expect(parseMultiTurnTaggedInput('prefix <user>x</user>')).toBeNull();
    expect(isMultiTurnTaggedInputString('hello')).toBe(false);
  });

  it('returns null for malformed tags', () => {
    expect(parseMultiTurnTaggedInput('<user>no close')).toBeNull();
    expect(parseMultiTurnTaggedInput('<user>a</user>trailing')).toBeNull();
  });

  it('isMultiTurnTaggedInputString matches parse', () => {
    expect(isMultiTurnTaggedInputString(sample)).toBe(true);
  });

  it('formatMultiTurnForCompactDisplay strips tags', () => {
    const s = formatMultiTurnForCompactDisplay(sample, 500);
    expect(s).toContain('User:');
    expect(s).toContain('Asst:');
    expect(s).not.toContain('<user>');
  });
});
