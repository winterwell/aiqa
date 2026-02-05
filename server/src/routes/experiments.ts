import { FastifyInstance } from 'fastify';
import {
  createExperiment,
  getExperiment,
  listExperiments,
  updateExperiment,
  deleteExperiment,
  getDataset,
} from '../db/db_sql.js';
import { searchExamples, searchSpans } from '../db/db_es.js';
import { authenticate, AuthenticatedRequest, checkAccess } from '../server_auth.js';
import SearchQuery from '../common/SearchQuery.js';
import { scoreMetric } from '../scoring.js';
import { getTokenUsage } from './server-span-utils.js';
import { GEN_AI_USAGE_TOTAL_TOKENS, GEN_AI_COST_USD } from '../common/constants_otel.js';

interface MetricStats {
	mean: number;
	min: number;
	max: number;
	var: number;
	count: number;
}

/**
 * Calculates Overall Score as geometric mean of all metric means.
 * Geometric mean: (x1 * x2 * ... * xn)^(1/n)
 * Returns null if no valid metrics found or if any metric mean is <= 0.
 */
function calculateOverallScore(summary: Record<string, MetricStats>): number | null {
	const metricMeans: number[] = [];
	
	for (const [metricName, stats] of Object.entries(summary)) {
		// Skip the overall_score itself if present
		if (metricName === 'Overall Score') {
			continue;
		}
		
		// Only include metrics with valid means > 0 (geometric mean requires positive values)
		if (stats.mean > 0 && isFinite(stats.mean)) {
			metricMeans.push(stats.mean);
		}
	}
	
	if (metricMeans.length === 0) {
		return null;
	}
	
	// Calculate geometric mean: (x1 * x2 * ... * xn)^(1/n)
	const product = metricMeans.reduce((acc, val) => acc * val, 1);
	const geometricMean = Math.pow(product, 1 / metricMeans.length);
	
	return geometricMean;
}

/**
 * Recalculates summary results from all results.
 * This is used when updating existing results to ensure accuracy.
 */
function recalculateSummaryResults(results: Array<{ scores: Record<string, number> }>): Record<string, MetricStats> {
	const summary: Record<string, MetricStats> = {};
	
	for (const result of results) {
		if (!result.scores) {
			continue;
		}
		for (const [metricName, value] of Object.entries(result.scores)) {
			// Skip non-numeric values
			if (typeof value !== 'number' || !isFinite(value)) {
				continue;
			}
			
			const existing = summary[metricName];
			if (!existing) {
				summary[metricName] = {
					mean: value,
					min: value,
					max: value,
					var: 0,
					count: 1,
				};
			} else {
				const oldCount = existing.count;
				const newCount = oldCount + 1;
				const oldMean = existing.mean;
				const delta = value - oldMean;
				const newMean = oldMean + delta / newCount;
				
				// Calculate variance using Welford's algorithm
				// M2 (sum of squared differences) = variance * (n - 1)
				// When oldCount = 1, existing.var = 0, so M2_old = 0
				// M2_new = M2_old + delta * (value - newMean)
				// variance_new = M2_new / (newCount - 1)
				let newVar: number;
				if (oldCount === 1) {
					// Special case: going from 1 to 2 values
					// M2_old = 0 (variance of 1 value is 0)
					// M2_new = 0 + delta * (value - newMean)
					newVar = (delta * (value - newMean)) / (newCount - 1);
				} else {
					// General case: M2_old = existing.var * (oldCount - 1)
					const m2Old = existing.var * (oldCount - 1);
					const m2New = m2Old + delta * (value - newMean);
					newVar = m2New / (newCount - 1);
				}
				
				summary[metricName] = {
					mean: newMean,
					min: Math.min(existing.min, value),
					max: Math.max(existing.max, value),
					var: newVar,
					count: newCount,
				};
			}
		}
	}
	
	// Calculate Overall Score as geometric mean of all metric means
  // TODO why is overall score not handled alongside other summary stats? Can we DRY and reduce code?
	const overallScore = calculateOverallScore(summary);
	if (overallScore !== null) {
		// For Overall Score, we use the geometric mean as the mean value
		// Min/max/variance are not as meaningful for a composite metric, but we calculate them from the individual scores
		const allOverallScores: number[] = [];
		for (const result of results) {
			if (!result.scores) continue;
			const metricMeans: number[] = [];
			for (const [metricName, value] of Object.entries(result.scores)) {
				if (metricName === 'Overall Score') continue;
				if (typeof value === 'number' && isFinite(value) && value > 0) {
					metricMeans.push(value);
				}
			}
			if (metricMeans.length > 0) {
				const product = metricMeans.reduce((acc, val) => acc * val, 1);
				const geoMean = Math.pow(product, 1 / metricMeans.length);
				allOverallScores.push(geoMean);
			}
		}
		
		if (allOverallScores.length > 0) {
			const min = Math.min(...allOverallScores);
			const max = Math.max(...allOverallScores);
			const count = allOverallScores.length;
			const variance = count > 1 
				? allOverallScores.reduce((sum, val) => sum + Math.pow(val - overallScore, 2), 0) / (count - 1)
				: 0;
			
			summary['Overall Score'] = {
				mean: overallScore,
				min,
				max,
				var: variance,
				count,
			};
		}
	}
	
	return summary;
}

/**
 * Updates summary results with new scores using rolling updates.
 * Uses Welford's online algorithm for variance calculation.
 */
function updateSummaryResults(summaries: Record<string, MetricStats> | undefined, scores: Record<string, number>): Record<string, MetricStats> {
	const updated = summaries ? { ...summaries } : {};

	for (const [metricName, value] of Object.entries(scores)) {
		// Skip non-numeric values
		if (typeof value !== 'number' || !isFinite(value)) {
			continue;
		}

		const existing = updated[metricName];
		
		if (!existing) {
			// First value for this metric
			updated[metricName] = {
				mean: value,
				min: value,
				max: value,
				var: 0,
				count: 1,
			};
		} else {
			// Rolling update using Welford's algorithm
			const oldCount = existing.count;
			const newCount = oldCount + 1;
			const oldMean = existing.mean;
			const delta = value - oldMean;
			const newMean = oldMean + delta / newCount;
			
			// Calculate variance using Welford's algorithm
			// M2 (sum of squared differences) = variance * (n - 1)
			// When oldCount = 1, existing.var = 0, so M2_old = 0
			// M2_new = M2_old + delta * (value - newMean)
			// variance_new = M2_new / (newCount - 1)
			let newVar: number;
			if (oldCount === 1) {
				// Special case: going from 1 to 2 values
				// M2_old = 0 (variance of 1 value is 0)
				// M2_new = 0 + delta * (value - newMean)
				newVar = (delta * (value - newMean)) / (newCount - 1);
			} else {
				// General case: M2_old = existing.var * (oldCount - 1)
				const m2Old = existing.var * (oldCount - 1);
				const m2New = m2Old + delta * (value - newMean);
				newVar = m2New / (newCount - 1);
			}
			
			updated[metricName] = {
				mean: newMean,
				min: Math.min(existing.min, value),
				max: Math.max(existing.max, value),
				var: newVar,
				count: newCount,
			};
		}
	}

	// Calculate Overall Score as geometric mean of all metric means
	const overallScore = calculateOverallScore(updated);
	if (overallScore !== null) {
		// For rolling updates, we calculate Overall Score from the current summary state
		// This gives us the geometric mean of metric means
		// For min/max, we approximate by using the geometric mean of metric mins/maxes
		const metricMeans: number[] = [];
		const metricMins: number[] = [];
		const metricMaxes: number[] = [];
		let maxCount = 0;
		
		for (const [metricName, stats] of Object.entries(updated)) {
			if (metricName === 'Overall Score') continue;
			if (stats.mean > 0 && isFinite(stats.mean)) {
				metricMeans.push(stats.mean);
			}
			if (stats.min > 0 && isFinite(stats.min)) {
				metricMins.push(stats.min);
			}
			if (stats.max > 0 && isFinite(stats.max)) {
				metricMaxes.push(stats.max);
			}
			maxCount = Math.max(maxCount, stats.count);
		}
		
		if (metricMeans.length > 0) {
			const geometricMean = overallScore; // Already calculated
			const min = metricMins.length > 0 ? Math.pow(metricMins.reduce((acc, val) => acc * val, 1), 1 / metricMins.length) : geometricMean;
			const max = metricMaxes.length > 0 ? Math.pow(metricMaxes.reduce((acc, val) => acc * val, 1), 1 / metricMaxes.length) : geometricMean;
			
			updated['Overall Score'] = {
				mean: geometricMean,
				min,
				max,
				var: 0, // Variance calculation would require all individual results, set to 0 for rolling updates
				count: maxCount,
			};
		}
	}

	return updated;
}

/**
 * Register experiment endpoints with Fastify
 */
export async function registerExperimentRoutes(fastify: FastifyInstance): Promise<void> {
  // Create experiment
  // Security: Authenticated users only. Organisation membership verified by authenticate middleware when organisation query param provided.
  fastify.post('/experiment', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const experiment = await createExperiment(request.body as any);
    return experiment;
  });

  // Get experiment by ID
  // Security: Authenticated users only. No organisation check - any authenticated user can view any experiment by ID.
  fastify.get('/experiment/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const { id } = request.params as { id: string };
    const experiment = await getExperiment(id);
    if (!experiment) {
      reply.code(404).send({ error: 'Experiment not found' });
      return;
    }
    return experiment;
  });

  // List experiments
  // Security: Authenticated users only. Organisation membership verified by authenticate middleware. Results filtered by organisationId in database (listExperiments).
  fastify.get('/experiment', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const organisationId = (request.query as any).organisation as string | undefined;
    if (!organisationId) {
      reply.code(400).send({ error: 'organisation query parameter is required' });
      return;
    }
    const query = (request.query as any).q as string | undefined;
    const searchQuery = query ? new SearchQuery(query) : null;
    const experiments = await listExperiments(organisationId, searchQuery);
    return experiments;
  });

  // Update experiment
  // Security: Authenticated users only. No organisation check - any authenticated user can update any experiment by ID.
  fastify.put('/experiment/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const { id } = request.params as { id: string };
    const experiment = await updateExperiment(id, request.body as any);
    if (!experiment) {
      reply.code(404).send({ error: 'Experiment not found' });
      return;
    }
    return experiment;
  });

  // Delete experiment
  // Security: Authenticated users only. No organisation check - any authenticated user can delete any experiment by ID.
  fastify.delete('/experiment/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const { id } = request.params as { id: string };
    const deleted = await deleteExperiment(id);
    if (!deleted) {
      reply.code(404).send({ error: 'Experiment not found' });
      return;
    }
    return { success: true };
  });

  /**
   * Score an example result for an experiment. You must first create the experiment with the createExperiment endpoint.
   * POST body: { output, trace, scores }
   * For each metric (from dataset or example), if scores has a value, use it;
   * otherwise the server runs scoring for that metric.
   * Security: Authenticated users only. Organisation membership verified by authenticate middleware. Verifies experiment.organisation matches request.organisation (endpoint handler).
   */
  fastify.post('/experiment/:id/example/:exampleid/scoreAndStore', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const { id: experimentId, exampleid: exampleId } = request.params as { id: string; exampleid: string };
    const body = request.body as { output: any; trace?: string; scores?: Record<string, number>; duration?: number };
    const organisation = request.organisation!;

    // Validate required fields
    if (body.output === undefined) {
      reply.code(400).send({ error: 'output is required in request body' });
      return;
    }
	if ( ! experimentId || ! organisation) {
		reply.code(400).send({ error: 'experimentId and organisation are required' });
		return;
	}

    // Get experiment
    const experiment = await getExperiment(experimentId);
    if (!experiment) {
		reply.code(404).send({ error: 'scoreAndStore: Experiment not found: ' + experimentId });
		return;
    }

    // Verify organisation matches
    if (experiment.organisation !== organisation) {
      reply.code(403).send({ error: 'scoreAndStore: Experiment does not belong to your organisation' });
      return;
    }

    // Get dataset
    const dataset = await getDataset(experiment.dataset);
    if (!dataset) {
      reply.code(404).send({ error: 'scoreAndStore: Dataset not found: ' + experiment.dataset });
      return;
    }

    // Get example by searching for it
    const exampleQuery = new SearchQuery(`id:${exampleId}`);
    let exampleResult;
    try {
      exampleResult = await searchExamples(exampleQuery, organisation, experiment.dataset, 1, 0);
    } catch (error: any) {
      if (error.name === 'ConnectionError' || error.message?.includes('ConnectionError')) {
        reply.code(503).send({ error: 'scoreAndStore: Elasticsearch service unavailable. Please check if Elasticsearch is running.' });
        return;
      }
      throw error;
    }
    if (exampleResult.total === 0 || exampleResult.hits.length === 0) {
      reply.code(404).send({ error: 'scoreAndStore: Example not found: ' + exampleId });
      return;
    }
    const example = exampleResult.hits[0];

    // Collect all metrics: from dataset and example
    const allMetrics: Array<{ metric: any; source: 'dataset' | 'example' }> = [];
    if (dataset.metrics) {
      if (Array.isArray(dataset.metrics)) {
        for (const metric of dataset.metrics) {
          allMetrics.push({ metric, source: 'dataset' });
        }
      } else {
        const metricsValue = dataset.metrics as any;
        request.log.warn({
          datasetId: dataset.id,
          datasetName: dataset.name,
          metricsType: typeof metricsValue,
          metricsValue: metricsValue,
          metricsConstructor: metricsValue?.constructor?.name,
        }, 'dataset.metrics is not an array');
      }
    }
    if (example.metrics) {
      if (Array.isArray(example.metrics)) {
        for (const metric of example.metrics) {
          allMetrics.push({ metric, source: 'example' });
        }
      } else {
        const metricsValue = example.metrics as any;
        request.log.warn({
          exampleId: example.id,
          metricsType: typeof metricsValue,
          metricsValue: metricsValue,
          metricsConstructor: metricsValue?.constructor?.name,
        }, 'example.metrics is not an array');
      }
    }

    // Start with scores from request body (includes duration and any pre-computed scores)
    const computedScores: Record<string, number> = { ...(body.scores || {}) };
    const computedErrors: Record<string, string> = {};
    
    // Extract token count and cost from spans if traceId is provided
    // Retry logic handles race condition: spans may still be indexing in ES after client flush
    if (body.trace) {
      try {
        // Retry with exponential backoff: spans may not be indexed immediately after flush
        let spanResult = null;
        const maxRetries = 3;
        const initialDelayMs = 100;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          // Find root span for this trace (parent:unset means it's a root span)
          const traceQuery = new SearchQuery(`trace:${body.trace} parent:unset`);
          spanResult = await searchSpans(traceQuery, organisation, 1, 0);
          
          if (spanResult.hits.length > 0) {
            break; // Found the span, exit retry loop
          }
          
          // If not found and not last attempt, wait before retrying
          if (attempt < maxRetries - 1) {
            const delayMs = initialDelayMs * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
        
        if (spanResult && spanResult.hits.length > 0) {
          const rootSpan = spanResult.hits[0];
          const tokenUsage = getTokenUsage(rootSpan);
          
          // Add token count and cost as system metrics (using IDs from defaultSystemMetrics.ts)
          // 0 can be valid (e.g. a cached response)
          if (tokenUsage.totalTokens >= 0) {
            computedScores[GEN_AI_USAGE_TOTAL_TOKENS] = tokenUsage.totalTokens;
          }
          if (tokenUsage.cost >= 0) {
            computedScores[GEN_AI_COST_USD] = tokenUsage.cost;
          }
        } else {
          // Spans not found after retries - log but don't fail (token info is optional)
          request.log.debug({ traceId: body.trace }, 'Root span not found after retries - token info will be missing');
        }
      } catch (error) {
        // Log error but don't fail the request - token info is optional
        request.log.warn({ traceId: body.trace, error }, 'Failed to extract token info from spans');
      }
    }
    
    // Compute scores for each metric. Key by metric.id (fallback name) so we match client-sent scores and webapp lookup.
    for (const { metric } of allMetrics) {
      const metricKey = metric.id || metric.name;

      // If score is already provided in request body, skip computation
      if (metricKey in computedScores) {
        continue;
      }

      // Otherwise, compute the score
      try {
        computedScores[metricKey] = await scoreMetric(organisation, metric, body.output, example);
      } catch (error) {
        // Record error for this metric but continue processing other metrics
        const message = error instanceof Error ? error.message : String(error);
        computedErrors[metricKey] = message;
      }
    }

    // Update experiment results - ensure it's always an array
    const results = Array.isArray(experiment.results) ? experiment.results : [];
    const existingResultIndex = results.findIndex(r => r.example === exampleId);
    const isUpdate = existingResultIndex >= 0;
    
    if (isUpdate) {
      // Update existing result
      results[existingResultIndex].scores = {
        ...results[existingResultIndex].scores,
        ...computedScores,
      };
      // Merge errors, keeping existing ones unless overwritten
      results[existingResultIndex].errors = {
        ...(results[existingResultIndex].errors || {}),
        ...computedErrors,
      };
    } else {
      // Add new result
      const newResult: any = {
        example: exampleId,
        scores: computedScores,
      };
      if (Object.keys(computedErrors).length > 0) {
        newResult.errors = computedErrors;
      }
      results.push(newResult);
    }

    // Update summary results
    // For new results, use rolling update. For updates, recalculate from all results to ensure accuracy.
    const updatedSummaries = isUpdate 
      ? recalculateSummaryResults(results)
      : updateSummaryResults(experiment.summaries, computedScores);

    // Update experiment with new results and summary
    const updatedExperiment = await updateExperiment(experimentId, { 
      results,
      summaries: updatedSummaries,
    });
    if (!updatedExperiment) {
      reply.code(500).send({ error: 'Failed to update experiment' });
      return;
    }

    return {
      success: true,
      scores: computedScores,
      errors: Object.keys(computedErrors).length > 0 ? computedErrors : undefined,
      example: exampleId,
    };
  });
}

