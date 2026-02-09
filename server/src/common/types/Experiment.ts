import { LifecycleStatus } from "./LifecycleStatus";


/** The Result from one example, with the scores for each metric */
export interface Result {
	example: string;
  trace?: string;
  /** TODO detect this in scoreAndStore
   * true if this example was affected by a tracing rate-limit 
   * - so token usage may be incomplete
  */
  rateLimited?: boolean;
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

export interface MetricStats {
  mean: number;
  min: number;
  max: number;
  var: number;
  count: number;
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
  summaries?: Record<string, MetricStats>;
  created: Date;
  updated: Date;
  /**
   * TODO Trace IDs from running the experiment. This allows for updating the experiment results
   * if a late span comes in.
   */
  traces?: string[];
  /* one row per example, with the scores for each metric */
  results?: Result[];
  /** closed => all results are in. */
  status?: LifecycleStatus; 
}

