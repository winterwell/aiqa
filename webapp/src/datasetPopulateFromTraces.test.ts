import { describe, it, expect } from 'vitest';
import { sinceIsoForWindow } from './datasetPopulateFromTraces';

describe('sinceIsoForWindow', () => {
	it('returns ISO time one day before nowMs for 1d', () => {
		const now = Date.parse('2026-03-28T12:00:00.000Z');
		const iso = sinceIsoForWindow('1d', now);
		expect(iso).toBe('2026-03-27T12:00:00.000Z');
	});

	it('returns ISO time one hour before nowMs for 1h', () => {
		const now = Date.parse('2026-03-28T12:00:00.000Z');
		const iso = sinceIsoForWindow('1h', now);
		expect(iso).toBe('2026-03-28T11:00:00.000Z');
	});
});
