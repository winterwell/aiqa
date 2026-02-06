import Metric from './Metric.js';

export default interface Dataset {
  /** uuid */
  id: string;
  organisation: string;
  name: string;
  description?: string;
  tags?: string[];
  metrics?: Metric[];
  // /** id for the user who omade it */
  // owner: string;
  created: Date;
  updated: Date;
  // version: number; updated will do
}

