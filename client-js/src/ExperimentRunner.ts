/**
 * ExperimentRunner - runs experiments on datasets and scores results
 */

import Example from './common/types/Example';

interface ExperimentRunnerOptions {
	datasetId: string;
	experimentId: string;
	serverUrl?: string;
	apiKey?: string;
	organisationId?: string;
}

interface ScoreResult {
	[metric: string]: any;
}

interface SummaryResult {
	[metric: string]: any;
}

export class ExperimentRunner {
	private datasetId: string;
	private serverUrl: string;
	private apiKey: string;
	private organisation?: string;
	private experimentId: string;
	private scores: Array<{ example: Example; result: any; scores: ScoreResult }> = [];

	constructor(options: ExperimentRunnerOptions) {
		this.datasetId = options.datasetId;
		this.experimentId = options.experimentId;
		this.serverUrl = (options.serverUrl || process.env.AIQA_SERVER_URL).replace(/\/$/, '');
		this.apiKey = options.apiKey || process.env.AIQA_API_KEY || '';
		this.organisation = options.organisationId;
	}
	

	/**
	 * Fetch example inputs from the dataset
	 */
	async getExampleInputs({limit = 10000}: {limit?: number} = {}): Promise<Example[]> {
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
			},
		);

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error');
			throw new Error(`Failed to fetch example inputs: ${response.status} ${response.statusText} - ${errorText}`);
		}

		const data = await response.json() as { hits?: Example[]; total?: number; limit?: number; offset?: number };
		return data.hits || [];
	}

	/**
	 * Ask the server to score an example result. Stores the score for later summary calculation.
	 */
	async scoreAndStore(example: Example, result: any, scores: Record<string, number> = {}): Promise<ScoreResult> {
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
		return response.json();
	}

	/**
	 * Run an engine function on all examples and score the results
	 */
	async run(engine: (input: any) => any | Promise<any>, 
	scorer?: (output: any, example: Example) => Promise<Record<string, number>>): Promise<void> 
	{
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

	private async runExample(example: Example, 
		engine: (input: any) => any | Promise<any>, 
		scorer: (output: any, example: Example) => Promise<Record<string, number>>): Promise<ScoreResult> 
	{
		// Handle both spans array and inputs field
		const input = example.inputs || (example.spans && example.spans.length > 0 ? example.spans[0].attributes?.input : undefined);
		if (!input) {
			console.warn('Example has no input field or spans with input attribute:', example);
			return null;
		}
		let start = Date.now();
		let pOutput = engine(input);
		let end = Date.now();
		const output = pOutput instanceof Promise ? await pOutput : pOutput;
		start = Date.now();
		let scores = {}
		if (scorer) {
			scores = await scorer(output, example);
		}
		scores['duration'] = end - start;
		return await this.scoreAndStore(example, output, scores);
	}		

	/**
	 * Get summary results aggregated from all scored examples
	 */
	async getSummaryResults(): Promise<SummaryResult[]> {
		// Calculate summary statistics from all scores
		// For now, return a simple summary. In a real implementation, this would:
		// 1. Aggregate metrics across all examples
		// 2. Calculate statistics (mean, median, etc.)
		// 3. Return structured summary results

		if (this.scores.length === 0) {
			return [];
		}

		// Simple summary: count of examples
		const summary: SummaryResult = {
			total_examples: this.scores.length,
			scored_examples: this.scores.length,
		};

		// If we have an experiment ID, we could fetch it from the server
		// For now, return the local summary
		return [summary];
	}
}

