import tap from 'tap';
import { normalizeTimeToMillis } from '../dist/routes/spans.js';

tap.test('normalizeTimeToMillis - ISO string format', t => {
  const isoString = '2024-01-15T10:30:00.000Z';
  const result = normalizeTimeToMillis(isoString);
  const expected = new Date(isoString).getTime();
  t.equal(result, expected, 'should convert ISO string to milliseconds');
  t.end();
});

tap.test('normalizeTimeToMillis - ISO string with milliseconds', t => {
  const isoString = '2024-01-15T10:30:00.123Z';
  const result = normalizeTimeToMillis(isoString);
  const expected = new Date(isoString).getTime();
  t.equal(result, expected, 'should handle ISO string with milliseconds');
  t.end();
});

tap.test('normalizeTimeToMillis - epoch milliseconds (number)', t => {
  const epochMs = 1705315800000; // 2024-01-15T10:30:00.000Z
  const result = normalizeTimeToMillis(epochMs);
  t.equal(result, epochMs, 'should return epoch milliseconds as-is');
  t.end();
});

tap.test('normalizeTimeToMillis - epoch nanoseconds (number >= 1e12)', t => {
  const epochNs = 1705315800000000000; // nanoseconds
  const result = normalizeTimeToMillis(epochNs);
  const expected = Math.floor(epochNs / 1_000_000);
  t.equal(result, expected, 'should convert nanoseconds to milliseconds');
  t.end();
});

tap.test('normalizeTimeToMillis - epoch nanoseconds string (>= 1e12)', t => {
  const epochNsString = '1705315800000000000';
  const result = normalizeTimeToMillis(epochNsString);
  const expected = Math.floor(parseFloat(epochNsString) / 1_000_000);
  t.equal(result, expected, 'should convert nanoseconds string to milliseconds');
  t.end();
});

tap.test('normalizeTimeToMillis - epoch milliseconds string (< 1e12)', t => {
  const epochMsString = '1705315800000';
  const result = normalizeTimeToMillis(epochMsString);
  const expected = parseFloat(epochMsString);
  t.equal(result, expected, 'should parse milliseconds string as-is');
  t.end();
});

tap.test('normalizeTimeToMillis - HrTime format [seconds, nanoseconds]', t => {
  const hrTime: [number, number] = [1705315800, 123456789];
  const result = normalizeTimeToMillis(hrTime);
  const expected = hrTime[0] * 1000 + Math.floor(hrTime[1] / 1_000_000);
  t.equal(result, expected, 'should convert HrTime to milliseconds');
  t.end();
});

tap.test('normalizeTimeToMillis - HrTime format with zero nanoseconds', t => {
  const hrTime: [number, number] = [1705315800, 0];
  const result = normalizeTimeToMillis(hrTime);
  const expected = hrTime[0] * 1000;
  t.equal(result, expected, 'should handle HrTime with zero nanoseconds');
  t.end();
});

tap.test('normalizeTimeToMillis - HrTime format with large nanoseconds', t => {
  const hrTime: [number, number] = [1705315800, 999999999];
  const result = normalizeTimeToMillis(hrTime);
  const expected = hrTime[0] * 1000 + Math.floor(hrTime[1] / 1_000_000);
  t.equal(result, expected, 'should handle HrTime with large nanoseconds');
  t.end();
});

tap.test('normalizeTimeToMillis - null input', t => {
  const result = normalizeTimeToMillis(null);
  t.equal(result, null, 'should return null for null input');
  t.end();
});

tap.test('normalizeTimeToMillis - undefined input', t => {
  const result = normalizeTimeToMillis(undefined);
  t.equal(result, null, 'should return null for undefined input');
  t.end();
});

tap.test('normalizeTimeToMillis - invalid ISO string', t => {
  const invalidString = 'not-a-date';
  const result = normalizeTimeToMillis(invalidString);
  t.equal(result, null, 'should return null for invalid ISO string');
  t.end();
});

tap.test('normalizeTimeToMillis - empty string', t => {
  const result = normalizeTimeToMillis('');
  t.equal(result, null, 'should return null for empty string');
  t.end();
});

tap.test('normalizeTimeToMillis - number at threshold (1e12)', t => {
  const threshold = 1e12;
  const result = normalizeTimeToMillis(threshold);
  // At exactly 1e12, it should be treated as nanoseconds
  const expected = Math.floor(threshold / 1_000_000);
  t.equal(result, expected, 'should treat 1e12 as nanoseconds');
  t.end();
});

tap.test('normalizeTimeToMillis - number just below threshold', t => {
  const justBelow = 1e12 - 1;
  const result = normalizeTimeToMillis(justBelow);
  t.equal(result, justBelow, 'should treat number < 1e12 as milliseconds');
  t.end();
});

tap.test('normalizeTimeToMillis - number just above threshold', t => {
  const justAbove = 1e12 + 1;
  const result = normalizeTimeToMillis(justAbove);
  const expected = Math.floor(justAbove / 1_000_000);
  t.equal(result, expected, 'should treat number >= 1e12 as nanoseconds');
  t.end();
});

tap.test('normalizeTimeToMillis - zero', t => {
  const result = normalizeTimeToMillis(0);
  t.equal(result, 0, 'should handle zero as milliseconds');
  t.end();
});

tap.test('normalizeTimeToMillis - negative number (milliseconds)', t => {
  const negative = -1000;
  const result = normalizeTimeToMillis(negative);
  t.equal(result, negative, 'should handle negative milliseconds');
  t.end();
});

tap.test('normalizeTimeToMillis - edge case: very large epoch milliseconds (year 2286)', t => {
  // Year 2286 is approximately 9.9e12 milliseconds
  const largeMs = 9999999999999; // Just under 1e13, treated as milliseconds
  const result = normalizeTimeToMillis(largeMs);
  t.equal(result, largeMs, 'should handle very large milliseconds (< 1e13)');
  t.end();
});

tap.test('normalizeTimeToMillis - round trip: ISO to milliseconds to ISO', t => {
  const isoString = '2024-01-15T10:30:00.123Z';
  const ms = normalizeTimeToMillis(isoString);
  t.ok(ms !== null, 'should convert ISO to milliseconds');
  const backToIso = new Date(ms!).toISOString();
  t.equal(backToIso, isoString, 'should round trip correctly');
  t.end();
});

tap.test('normalizeTimeToMillis - round trip: HrTime to milliseconds to HrTime', t => {
  const hrTime: [number, number] = [1705315800, 123456789];
  const ms = normalizeTimeToMillis(hrTime);
  t.ok(ms !== null, 'should convert HrTime to milliseconds');
  const expectedMs = hrTime[0] * 1000 + Math.floor(hrTime[1] / 1_000_000);
  t.equal(ms, expectedMs, 'should match expected conversion');
  t.end();
});


