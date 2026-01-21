import { Metric } from './Metric.js';

export default interface Dataset {
  /** uuid */
  id: string;
  organisation: string;
  name: string;
  description?: string;
  tags?: string[];
  input_schema?: any;
  output_schema?: any;
  metrics?: Metric[];
  created: Date;
  updated: Date;
}

