/**
 * ExperimentRunner - runs experiments on datasets and scores results
 */

import Example from './common/types/Example';
import Dataset, { Metric } from './common/types/Dataset';
import Experiment from './common/types/Experiment';

interface ExperimentRunnerOptions {
	datasetId: string;
	/** usuallu unset, and a fresh experiment is created with a random ID */
	experimentId?: string;
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

interface MetricStats {
	mean: number;
	min: number;
	max: number;
	var: number;
	count: number;
	// Internal state for Welford's algorithm
	_sumSq: number; // sum of squared differences from mean
}

export class ExperimentRunner {
	private datasetId: string;
	private serverUrl: string;
	private apiKey: string;
	private organisation?: string;
	private experimentId: string;
	private experiment?: Experiment;
	private scores: Array<{ example: Example; result: any; scores: ScoreResult }> = [];
	private summaryResults: Record<string, MetricStats> = {};

	constructor(options: ExperimentRunnerOptions) {
		this.datasetId = options.datasetId;
		this.experimentId = options.experimentId;
		this.serverUrl = (options.serverUrl || process.env.AIQA_SERVER_URL).replace(/\/$/, '');
		this.apiKey = options.apiKey || process.env.AIQA_API_KEY || '';
		this.organisation = options.organisationId;
	}

	/**
	 * Fetch the dataset to get its metrics
	 */
	async getDataset(): Promise<Dataset> {
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

		const dataset = await response.json() as Dataset;
		return dataset;
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
	 * Create an experiment if one does not exist.
	 * @param experiment - optional setup for the experiment object. You may wish to set: 
	 * - name
	 * - parameters
	 * - comparison_parameters
	 * @returns the created experiment object
	 */
	async createExperiment(experimentSetup?: Partial<Experiment>): Promise<Experiment> {
		if ( ! this.organisation || ! this.datasetId) {
			throw new Error('Organisation and dataset ID are required to create an experiment');
		}
		if ( ! experimentSetup) {
			experimentSetup = {} as Partial<Experiment>;
		}
		// fill in if not set
		experimentSetup = {
			...experimentSetup,
			organisation: this.organisation,
			dataset: this.datasetId,
			results: [],
			summary_results: {},
		};
		console.log('Creating experiment');
		const response = await fetch(`${this.serverUrl}/experiment`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `ApiKey ${this.apiKey}`
			},
			body: JSON.stringify(experimentSetup),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error');
			throw new Error(`Failed to create experiment: ${response.status} ${response.statusText} - ${errorText}`);
		}

		const experiment = await response.json() as Experiment;
		this.experimentId = experiment.id;
		this.experiment = experiment;
		return experiment;
	}

	/**
	 * Ask the server to score an example result. Stores the score for later summary calculation.
	 */
	async scoreAndStore(example: Example, result: any, scores: Record<string, number> = {}): Promise<ScoreResult> {
		// Do we have an experiment ID? If not, we need to create the experiment first
		if ( ! this.experimentId) {
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

	/**
	 * Run the engine on an example with the given parameters (looping over comparison parameters), and score the result.
	 * @param example 
	 * @param engine 
	 * @param scorer 
	 * @returns one set of scores for each comparison parameter set. If no comparison parameters, returns an array of one.
	 */
	async runExample(example: Example, 
		engine: (input: any, parameters: Record<string, any>) => any | Promise<any>, 
		scorer: (output: any, example: Example, parameters: Record<string, any>) => Promise<Record<string, number>>): Promise<ScoreResult[]> 
	{
		// Ensure experiment exists
		if (!this.experiment) {
			await this.createExperiment();
		}
		if (!this.experiment) {
			throw new Error('Failed to create experiment');
		}
		// make the parameters
		let parametersFixed = this.experiment.parameters || {};
		let parametersLoop = this.experiment.comparison_parameters || [];
		// Handle both spans array and input field
		const input = example.input || (example.spans && example.spans.length > 0 ? example.spans[0].attributes?.input : undefined);
		if (!input) {
			console.warn('Example has no input field or spans with input attribute:', example);
			// run engine anyway -- this could make sense if its all about the parameters
		}
		let allScores: ScoreResult[] = [];
		// This loop should not be parallelized - it should run sequentially, one after the other - to avoid creating interference between the runs.
		for (const parameters of parametersLoop) {
			const parametersHere = { ...parametersFixed, ...parameters };
			const start = Date.now();
			let pOutput = engine(input, parametersHere);
			const output = pOutput instanceof Promise ? await pOutput : pOutput;
			const end = Date.now();
			const duration = end - start;
			
			let scores = {}
			if (scorer) {
				scores = await scorer(output, example, parametersHere);
			}
			scores['duration'] = duration;
			// TODO this call as async and wait for all to complete before returning
			const result = await this.scoreAndStore(example, output, scores);
			allScores.push(result);
		}
		return allScores;
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

