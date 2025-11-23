export interface Dataset {
  id: string;
  organisation_id: string;
  name: string;
  description?: string;
  tags?: string[];
  input_schema?: any;
  output_schema?: any;
  metrics?: any;
  created: Date;
  updated: Date;
}

