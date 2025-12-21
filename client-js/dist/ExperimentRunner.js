"use strict";
/**
 * ExperimentRunner - runs experiments on datasets and scores results
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExperimentRunner = void 0;
class ExperimentRunner {
    constructor(options) {
        this.scores = [];
        this.summaryResults = {};
        this.datasetId = options.datasetId;
        this.experimentId = options.experimentId;
        this.serverUrl = (options.serverUrl || process.env.AIQA_SERVER_URL).replace(/\/$/, '');
        this.apiKey = options.apiKey || process.env.AIQA_API_KEY || '';
        this.organisation = options.organisationId;
    }
    /**
     * Fetch the dataset to get its metrics
     */
    async getDataset() {
        const response = await fetch(`${this.serverUrl}/dataset/${this.datasetId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `ApiKey ${this.apiKey}`
            },
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`Failed to fetch dataset: ${response.status} ${response.statusText} - ${errorText}`);
        }
        const dataset = await response.json();
        return dataset;
    }
    /**
     * Fetch example inputs from the dataset
     */
    async getExampleInputs({ limit = 10000 } = {}) {
        const params = new URLSearchParams();
        params.append('dataset_id', this.datasetId);
        if (this.organisation) {
            params.append('organisation', this.organisation);
        }
        params.append('limit', limit.toString()); // Fetch big - probably all the examples
        const response = await fetch(`${this.serverUrl}/example?${params.toString()}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `ApiKey ${this.apiKey}`
            }
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`Failed to fetch example inputs: ${response.status} ${response.statusText} - ${errorText}`);
        }
        const data = await response.json();
        return data.hits || [];
    }
    async createExperiment() {
        if (!this.organisation || !this.datasetId) {
            throw new Error('Organisation and dataset ID are required to create an experiment');
        }
        console.log('Creating experiment');
        const response = await fetch(`${this.serverUrl}/experiment`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `ApiKey ${this.apiKey}`
            },
            body: JSON.stringify({
                organisation: this.organisation,
                dataset: this.datasetId,
                results: [],
                summary_results: {},
            }),
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`Failed to create experiment: ${response.status} ${response.statusText} - ${errorText}`);
        }
        const experiment = await response.json();
        this.experimentId = experiment.id;
        return experiment;
    }
    /**
     * Ask the server to score an example result. Stores the score for later summary calculation.
     */
    async scoreAndStore(example, result, scores = {}) {
        // Do we have an experiment ID? If not, we need to create the experiment first
        if (!this.experimentId) {
            await this.createExperiment();
        }
        console.log('Scoring and storing example:', example.id);
        const response = await fetch(`${this.serverUrl}/experiment/${this.experimentId}/example/${example.id}/scoreAndStore`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `ApiKey ${this.apiKey}`
            },
            body: JSON.stringify({
                output: result,
                traceId: example.traceId,
                scores
            }),
        });
        console.log('Response:', response);
        return response.json();
    }
    /**
     * Run an engine function on all examples and score the results
     */
    async run(engine, scorer) {
        const examples = await this.getExampleInputs();
        for (const example of examples) {
            const scores = await this.runExample(example, engine, scorer);
            if (scores) {
                this.scores.push({
                    example,
                    result: scores,
                    scores: scores,
                });
            }
        }
    }
    async runExample(example, engine, scorer) {
        // Handle both spans array and input field
        const input = example.input || (example.spans && example.spans.length > 0 ? example.spans[0].attributes?.input : undefined);
        if (!input) {
            console.warn('Example has no input field or spans with input attribute:', example);
            return null;
        }
        const start = Date.now();
        let pOutput = engine(input);
        const output = pOutput instanceof Promise ? await pOutput : pOutput;
        const end = Date.now();
        const duration = end - start;
        let scores = {};
        if (scorer) {
            scores = await scorer(output, example);
        }
        scores['duration'] = duration;
        return await this.scoreAndStore(example, output, scores);
    }
    /**
     * Get summary results aggregated from all scored examples
     */
    async getSummaryResults() {
        // Calculate summary statistics from all scores
        // For now, return a simple summary. In a real implementation, this would:
        // 1. Aggregate metrics across all examples
        // 2. Calculate statistics (mean, median, etc.)
        // 3. Return structured summary results
        if (this.scores.length === 0) {
            return [];
        }
        // Simple summary: count of examples
        const summary = {
            total_examples: this.scores.length,
            scored_examples: this.scores.length,
        };
        // If we have an experiment ID, we could fetch it from the server
        // For now, return the local summary
        return [summary];
    }
}
exports.ExperimentRunner = ExperimentRunner;
