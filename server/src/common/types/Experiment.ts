

/** The Result from one example, with the scores for each metric */
export interface Result {
	exampleId: string;
  traceId?: string;
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
  /** Good practice to give a meaningful name to the experiment */
  name?: string;
  /** 
   * The parameters you are testing in this experiment, e.g. model:gpt-4o vs another Experiment with model:gpt-4o-mini 
   * These + comparison_parameters are (a) set as environment variables, and (b) passed as kwargs to the engine function.
  */
  parameters?: Record<string, any>;
  /** 
   * @deprecated
   * The parameters you are directly comparing this experiment with multiple tests, e.g. model:gpt-4o vs model:gpt-4o-mini 
   * -- and the ExperimentRunner will do both.
   * For each example, the runner will loop over this array, and run the engine with each set of parameters.
   * These + parameters are (a) set as environment variables, and (b) passed as kwargs to the engine function, in a loop.
   * TODO rethinking this - move to multiple linked Experiment with a batch id, with experiment runner managing switching between them
   */
  comparison_parameters?: Array<Record<string, any>>;
  /** metric name: -> summary stats: average, min, max, variance, histogram, count */
  summary_results?: any;
  created: Date;
  updated: Date;
  /* one row per example, with the scores for each metric */
  results?: Result[];
}

