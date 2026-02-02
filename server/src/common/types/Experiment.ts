

/** The Result from one example, with the scores for each metric */
export interface Result {
	example: string;
  trace?: string;
	scores: {
		[metricName: string]: number;
	},
  messages?: {
    [metricName: string]: string;
  }
	errors?: {
		[metricName: string]: string;
	}
}

/**
 * The Result from one example and one metric
 */
export interface MetricResult {
  score: number;
  message?: string;
  error?: string;
}


/** An Experiment is a run of a Dataset of examples over your code, scoring the outputs.
 * Individual results may be traced as per normal tracing.
 */
export default interface Experiment {
  id: string;
  dataset: string;
  organisation: string;
  /** optional - links a set of experiments together for comparison */
  batch?: string;
  /** Good practice to give a meaningful name to the experiment */
  name?: string;
  /** Parameters for this experiment (e.g. model, temperature). Set as env vars and passed as kwargs to the engine. */
  parameters?: Record<string, any>;
  /** metric name: -> summary stats: average, min, max, variance, histogram, count */
  summaries?: any;
  created: Date;
  updated: Date;
  /* one row per example, with the scores for each metric */
  results?: Result[];
}

