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
import { authenticate, AuthenticatedRequest } from '../server_auth.js';
import SearchQuery from '../common/SearchQuery.js';
import { scoreMetric } from '../common/scoring.js';

/**
 * Register experiment endpoints with Fastify
 */
export async function registerExperimentRoutes(fastify: FastifyInstance): Promise<void> {
  // Create experiment
  fastify.post('/experiment', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    const experiment = await createExperiment(request.body as any);
    return experiment;
  });

  // Get experiment by ID
  fastify.get('/experiment/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    const { id } = request.params as { id: string };
    const experiment = await getExperiment(id);
    if (!experiment) {
      reply.code(404).send({ error: 'Experiment not found' });
      return;
    }
    return experiment;
  });

  // List experiments
  fastify.get('/experiment', { preHandler: authenticate }, async (request, reply) => {
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
  fastify.put('/experiment/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const experiment = await updateExperiment(id, request.body as any);
    if (!experiment) {
      reply.code(404).send({ error: 'Experiment not found' });
      return;
    }
    return experiment;
  });

  // Delete experiment
  fastify.delete('/experiment/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await deleteExperiment(id);
    if (!deleted) {
      reply.code(404).send({ error: 'Experiment not found' });
      return;
    }
    return { success: true };
  });

  /**
   * Score an example result for an experiment.
   * POST body: { output, traceId, scores }
   * For each metric (from dataset or example), if scores has a value, use it;
   * otherwise the server runs scoring for that metric.
   */
  fastify.post('/experiment/:id/example/:exampleid/scoreAndStore', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    const { id: experimentId, exampleid: exampleId } = request.params as { id: string; exampleid: string };
    const body = request.body as { output: any; traceId?: string; scores?: Record<string, number> };
    const organisation = request.organisation!;

    // Validate required fields
    if (body.output === undefined) {
      reply.code(400).send({ error: 'output is required in request body' });
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
    const exampleResult = await searchExamples(exampleQuery, organisation, experiment.dataset, 1, 0);
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
          const message = error instanceof Error ? error.message : String(error);
          reply.code(500).send({ 
            error: `Failed to score metric "${metricName}": ${message}` 
          });
          return;
        }
      }
    }

    // Update experiment results
    const results = experiment.results || [];
    const existingResultIndex = results.findIndex(r => r.exampleId === exampleId);
    
    if (existingResultIndex >= 0) {
      // Update existing result
      results[existingResultIndex].scores = {
        ...results[existingResultIndex].scores,
        ...computedScores,
      };
    } else {
      // Add new result
      results.push({
        exampleId,
        scores: computedScores,
      });
    }

    // Update experiment with new results
    const updatedExperiment = await updateExperiment(experimentId, { results });
    if (!updatedExperiment) {
      reply.code(500).send({ error: 'Failed to update experiment' });
      return;
    }

    return {
      success: true,
      scores: computedScores,
      exampleId,
    };
  });
}

