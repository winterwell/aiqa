
export interface Metric {
  name: string;
  description?: string;
  unit?: string;
}

export interface Dataset {
  id: string;
  organisation_id: string;
  name: string;
  description?: string;
  tags?: string[];
  input_schema?: any;
  output_schema?: any;
  metrics?: Metric[];
  created: Date;
  updated: Date;
}

