import { FastifyInstance } from 'fastify';
import {
  createExperiment,
  getExperiment,
  listExperiments,
  updateExperiment,
  deleteExperiment,
  getDataset,
} from '../db/db_sql.js';
import { searchExamples } from '../db/db_es.js';
import { authenticate, AuthenticatedRequest, checkAccess } from '../server_auth.js';
import SearchQuery from '../common/SearchQuery.js';
import { scoreMetric } from '../scoring.js';

interface MetricStats {
	mean: number;
	min: number;
	max: number;
	var: number;
	count: number;
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
	
	return summary;
}

/**
 * Updates summary results with new scores using rolling updates.
 * Uses Welford's online algorithm for variance calculation.
 */
function updateSummaryResults(summaryResults: Record<string, MetricStats> | undefined, scores: Record<string, number>): Record<string, MetricStats> {
	const updated = summaryResults ? { ...summaryResults } : {};

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
   * POST body: { output, traceId, scores }
   * For each metric (from dataset or example), if scores has a value, use it;
   * otherwise the server runs scoring for that metric.
   * Security: Authenticated users only. Organisation membership verified by authenticate middleware. Verifies experiment.organisation matches request.organisation (endpoint handler).
   */
  fastify.post('/experiment/:id/example/:exampleid/scoreAndStore', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const { id: experimentId, exampleid: exampleId } = request.params as { id: string; exampleid: string };
    const body = request.body as { output: any; traceId?: string; scores?: Record<string, number> };
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
		reply.code(404).send({ error: 'Experiment not found' });
		return;
    }

    // Verify organisation matches
    if (experiment.organisation !== organisation) {
      reply.code(403).send({ error: 'Experiment does not belong to your organisation' });
      return;
    }

    // Get dataset
    const dataset = await getDataset(experiment.dataset);
    if (!dataset) {
      reply.code(404).send({ error: 'Dataset not found' });
      return;
    }

    // Get example by searching for it
    const exampleQuery = new SearchQuery(`id:${exampleId}`);
    let exampleResult;
    try {
      exampleResult = await searchExamples(exampleQuery, organisation, experiment.dataset, 1, 0);
    } catch (error: any) {
      if (error.name === 'ConnectionError' || error.message?.includes('ConnectionError')) {
        reply.code(503).send({ error: 'Elasticsearch service unavailable. Please check if Elasticsearch is running.' });
        return;
      }
      throw error;
    }
    if (exampleResult.total === 0 || exampleResult.hits.length === 0) {
      reply.code(404).send({ error: 'Example not found' });
      return;
    }
    const example = exampleResult.hits[0];

    // Collect all metrics: from dataset and example
    const allMetrics: Array<{ metric: any; source: 'dataset' | 'example' }> = [];
    if (dataset.metrics) {
      for (const metric of dataset.metrics) {
        allMetrics.push({ metric, source: 'dataset' });
      }
    }
    if (example.metrics) {
      for (const metric of example.metrics) {
        allMetrics.push({ metric, source: 'example' });
      }
    }

    // Compute scores for each metric
    const computedScores: Record<string, number> = {};
    const computedErrors: Record<string, string> = {};
    for (const { metric } of allMetrics) {
      const metricName = metric.name;
      
      // If score is provided in request body, use it
      if (body.scores && metricName in body.scores) {
        computedScores[metricName] = body.scores[metricName];
      } else {
        // Otherwise, compute the score
        try {
          computedScores[metricName] = await scoreMetric(organisation, metric, body.output, example);
        } catch (error) {
          // Record error for this metric but continue processing other metrics
          const message = error instanceof Error ? error.message : String(error);
          computedErrors[metricName] = message;
        }
      }
    }

    // Update experiment results - ensure it's always an array
    const results = Array.isArray(experiment.results) ? experiment.results : [];
    const existingResultIndex = results.findIndex(r => r.exampleId === exampleId);
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
        exampleId,
        scores: computedScores,
      };
      if (Object.keys(computedErrors).length > 0) {
        newResult.errors = computedErrors;
      }
      results.push(newResult);
    }

    // Update summary results
    // For new results, use rolling update. For updates, recalculate from all results to ensure accuracy.
    const updatedSummaryResults = isUpdate 
      ? recalculateSummaryResults(results)
      : updateSummaryResults(experiment.summary_results, computedScores);

    // Update experiment with new results and summary
    const updatedExperiment = await updateExperiment(experimentId, { 
      results,
      summary_results: updatedSummaryResults,
    });
    if (!updatedExperiment) {
      reply.code(500).send({ error: 'Failed to update experiment' });
      return;
    }

    return {
      success: true,
      scores: computedScores,
      errors: Object.keys(computedErrors).length > 0 ? computedErrors : undefined,
      exampleId,
    };
  });
}

