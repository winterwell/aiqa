import { createExampleFromSpans, searchSpans } from './api';
import Span, { getTraceId } from './common/types/Span';

export type TraceSampleWindow = '1h' | '1d' | '1w';

const WINDOW_MS: Record<TraceSampleWindow, number> = {
	'1h': 60 * 60 * 1000,
	'1d': 24 * 60 * 60 * 1000,
	'1w': 7 * 24 * 60 * 60 * 1000,
};

/** Pool size: root spans fetched, then we randomly sample up to `count` distinct traces. */
const MAX_ROOTS_FOR_POOL = 500;

export function sinceIsoForWindow(window: TraceSampleWindow, nowMs = Date.now()): string {
	return new Date(nowMs - WINDOW_MS[window]).toISOString();
}

function shuffleInPlace<T>(arr: T[]): void {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
}

/**
 * After creating a dataset, add examples by sampling distinct traces from root spans
 * in the given time window (random sample, then full trace spans per example).
 */
export async function populateDatasetFromRecentTraces(args: {
	organisationId: string;
	datasetId: string;
	count: number;
	window: TraceSampleWindow;
}): Promise<{ created: number; failed: number }> {
	const { organisationId, datasetId, count, window } = args;
	if (count <= 0) return { created: 0, failed: 0 };

	const sinceIso = sinceIsoForWindow(window);
	const query = `start:>=${sinceIso}`;

	const rootResult = await searchSpans({
		organisationId,
		query,
		isRoot: true,
		limit: MAX_ROOTS_FOR_POOL,
		offset: 0,
		sort: 'start:desc',
		fields: '*',
	});

	const hits = rootResult.hits || [];
	const traceIds = [...new Set(hits.map((s: Span) => getTraceId(s)).filter(Boolean))] as string[];
	shuffleInPlace(traceIds);
	const picked = traceIds.slice(0, count);

	const spanGroups = await Promise.all(
		picked.map(async (traceId) => {
			const traceResult = await searchSpans({
				organisationId,
				query: `trace:${traceId}`,
				limit: 1000,
				offset: 0,
				fields: '*',
			});
			return { traceId, spans: (traceResult.hits || []) as Span[] };
		})
	);

	let created = 0;
	let failed = 0;

	for (const { spans } of spanGroups) {
		if (spans.length === 0) {
			failed++;
			continue;
		}
		try {
			await createExampleFromSpans({
				organisationId,
				datasetId,
				spans,
			});
			created++;
		} catch {
			failed++;
		}
	}

	return { created, failed };
}
