/**
 * ExperimentRunner - runs experiments on datasets and scores results
 */

interface ExperimentRunnerOptions {
	datasetId: string;
	serverUrl?: string;
	apiKey?: string;
	organisationId?: string;
}

interface Example {
	input: any;
	id: string;

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
	private organisationId?: string;
	private experimentId?: string;
	private scores: Array<{ example: Example; result: any; scores: ScoreResult }> = [];

	constructor(options: ExperimentRunnerOptions) {
		this.datasetId = options.datasetId;
		this.serverUrl = (options.serverUrl || process.env.AIQA_SERVER_URL).replace(/\/$/, '');
		this.apiKey = options.apiKey || process.env.AIQA_API_KEY || '';
		this.organisationId = options.organisationId;
	}
	

	/**
	 * Fetch example inputs from the dataset
	 */
	async getExampleInputs(): Promise<Example[]> {
		const params = new URLSearchParams();
		params.append('dataset_id', this.datasetId);
		if (this.organisationId) {
			params.append('organisation_id', this.organisationId);
		}
		params.append('limit', '10000'); // Fetch big - probably all the examples

		const response = await fetch(`${this.serverUrl}/input?${params.toString()}`, {
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
	 * Score an example result. Stores the score for later summary calculation.
	 */
	async score(example: Example, result: any): Promise<ScoreResult> {
		const scores = await fetch(`${this.serverUrl}/dataset/${this.datasetId}/score`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `ApiKey ${this.apiKey}`
			},
			body: JSON.stringify({ example, result }),
		});
		return scores.json();
	}

	/**
	 * Run an engine function on all examples and score the results
	 */
	async run(engine: (input: any) => any | Promise<any>): Promise<void> {
		const examples = await this.getExampleInputs();
		
		for (const example of examples) {
			const input = example.input;
			const result = await Promise.resolve(engine(input));
			await this.score(example, result);
		}
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

