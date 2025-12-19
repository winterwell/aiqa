


interface Result {
	exampleId: string;
	scores: {
		[metricName: string]: number;
	}
}

/** An Experijment is a run of a Dataset of examples over your code, scoring the outputs.
 * Individual results may be traced as per normal tracing.
 */
export default interface Experiment {
  id: string;
  dataset: string;
  organisation: string;
  summary_results: any;
  created: Date;
  updated: Date;
  results: Result[];
}

