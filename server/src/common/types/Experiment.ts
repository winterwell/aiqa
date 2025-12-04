
/**
 * An Experijment is a run of a Dataset of examples over your code, scoring the outputs.
 * Individual results may be traced as per normal tracing.
 */
export interface Experiment {
  id: string;
  dataset_id: string;
  organisation_id: string;
  summary_results: any;
  created: Date;
  updated: Date;
}

