import { FastifyInstance } from 'fastify';
import {
  createExperiment,
  getExperiment,
  listExperiments,
  updateExperiment,
  deleteExperiment,
  getDataset,
} from '../db/db_sql.js';
import { getExample, searchExamples, searchSpans } from '../db/db_es.js';
import { authenticate, AuthenticatedRequest, checkAccess } from '../server_auth.js';
import SearchQuery from '../common/SearchQuery.js';
import { scoreMetric } from '../scoring.js';
import { getSpanStatsFromAttributes } from './server-span-utils.js';
import { GEN_AI_USAGE_TOTAL_TOKENS, GEN_AI_COST_USD } from '../common/constants_otel.js';
import { recalculateSummaryResults, updateSummaryResults } from '../experiments/summary.js';
import { Result } from '../common/types/Experiment.js';
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
   * N
   * Security: Authenticated users only. Organisation membership verified by authenticate middleware. Verifies experiment.organisation matches request.organisation (endpoint handler).
   */
  fastify.post('/experiment/:id/example/:exampleid/scoreAndStore', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const { id: experimentId, exampleid: exampleId } = request.params as { id: string; exampleid: string };
    const body = request.body as { output: any; trace?: string; scores?: Record<string, number> };
    const organisation = request.organisation!;

    // Validate required fields
    if (!experimentId || !organisation) {
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

    // Get example
    const example = await getExample(exampleId, organisation);
    if (!example) {
      reply.code(404).send({ error: 'scoreAndStore: Example not found: ' + exampleId });
      return;
    }

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


    // Extract token count and cost from spans if traceId is provided
    // Retry logic handles race condition: spans may still be indexing in ES after client flush
    if (body.trace) {
      // Note: race condition: spans may not be indexed immediately after flush.
      // So we also do a search and update when a span comes in.
      try {
        // Retry with exponential backoff: spans may not be indexed immediately after flush
        let spanResult = null;
        const maxRetries = 3;
        const initialDelayMs = 100;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          // Find root span for this trace (parent:unset means it's a root span)
          const searchQuery = new SearchQuery(`trace:${body.trace} parent:unset`);
          spanResult = await searchSpans({searchQuery, organisation, limit: 1, offset: 0});

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
          const tokenUsage = rootSpan.stats || getSpanStatsFromAttributes(rootSpan);

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

    // Update experiment results - ensure it's always an array
    const results = Array.isArray(experiment.results) ? experiment.results : [];
    const existingResultIndex = results.findIndex(r => r.example === exampleId);
    const isUpdate = existingResultIndex >= 0;

    let result: Result;
    if (isUpdate) {
      // Update existing result
      result = results[existingResultIndex];
      result.scores = {
        ...result.scores,
        ...computedScores,
      };
      if (body.trace) {
        result.trace = body.trace;
      }
      // Merge errors, keeping existing ones unless overwritten
      result.errors = {
        ...(result.errors || {}),
        ...computedErrors,
      };
    } else {
      // Add new result
      result = {
        example: exampleId,
        scores: computedScores,
        trace: body.trace,
      };
      if (Object.keys(computedErrors).length > 0) {
        result.errors = computedErrors;
      }
      results.push(result);
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

    return results[isUpdate ? existingResultIndex : results.length - 1];
  });
}
