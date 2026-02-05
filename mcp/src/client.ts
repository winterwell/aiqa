/**
 * HTTP client for communicating with server-aiqa API
 */
export class AiqaApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: any
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `ApiKey ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    // Handle empty responses
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json() as T;
    }
    return {} as T;
  }

  // Dataset operations
  async createDataset(dataset: {
    organisation: string;
    name: string;
    description?: string;
    tags?: string[];
    metrics?: any[];
  }): Promise<any> {
    return this.request('POST', '/dataset', dataset);
  }

  async getDataset(id: string): Promise<any> {
    return this.request('GET', `/dataset/${id}`);
  }

  async listDatasets(organisation?: string, query?: string, limit?: number, offset?: number): Promise<any> {
    const params = new URLSearchParams();
    if (organisation) params.append('organisation', organisation);
    if (query) params.append('q', query);
    if (limit) params.append('limit', limit.toString());
    if (offset) params.append('offset', offset.toString());
    const queryString = params.toString();
    return this.request('GET', `/dataset${queryString ? `?${queryString}` : ''}`);
  }

  // Example operations
  async createExample(example: {
    id?: string;
    dataset: string;
    organisation: string;
    name?: string;
    tags?: string[];
    annotations?: Record<string, any>;
    spans?: any[];
    input?: any;
    outputs?: { good: any; bad: any };
    metrics?: any[];
    trace?: string;
  }): Promise<any> {
    return this.request('POST', '/example', example);
  }

  async getExample(id: string): Promise<any> {
    return this.request('GET', `/example/${id}`);
  }

  async listExamples(
    dataset?: string,
    query?: string,
    limit?: number,
    offset?: number
  ): Promise<any> {
    const params = new URLSearchParams();
    if (dataset) params.append('dataset', dataset);
    if (query) params.append('q', query);
    if (limit) params.append('limit', limit.toString());
    if (offset) params.append('offset', offset.toString());
    const queryString = params.toString();
    return this.request('GET', `/example${queryString ? `?${queryString}` : ''}`);
  }

  // Experiment operations
  async createExperiment(experiment: {
    id?: string;
    dataset: string;
    organisation: string;
    name?: string;
    batch?: string;
    parameters?: Record<string, any>;
  }): Promise<any> {
    return this.request('POST', '/experiment', experiment);
  }

  async getExperiment(id: string): Promise<any> {
    return this.request('GET', `/experiment/${id}`);
  }

  async listExperiments(
    dataset?: string,
    organisation?: string,
    query?: string,
    limit?: number,
    offset?: number
  ): Promise<any> {
    const params = new URLSearchParams();
    if (dataset) params.append('dataset', dataset);
    if (organisation) params.append('organisation', organisation);
    if (query) params.append('q', query);
    if (limit) params.append('limit', limit.toString());
    if (offset) params.append('offset', offset.toString());
    const queryString = params.toString();
    return this.request('GET', `/experiment${queryString ? `?${queryString}` : ''}`);
  }

  // Trace operations
  async queryTraces(
    organisation: string,
    query?: string,
    limit?: number,
    offset?: number,
    fields?: string,
    exclude?: string,
    isRoot?: boolean
  ): Promise<any> {
    const params = new URLSearchParams();
    params.append('organisation', organisation);
    if (query) params.append('q', query);
    if (limit) params.append('limit', limit.toString());
    if (offset) params.append('offset', offset.toString());
    if (fields) params.append('fields', fields);
    if (exclude) params.append('exclude', exclude);
    if (isRoot) {
      // For root spans, modify query to include parent:unset
      const rootQuery = query ? `(${query}) AND parent:unset` : 'parent:unset';
      params.set('q', rootQuery);
    }
    return this.request('GET', `/span?${params.toString()}`);
  }

  async getTraceStats(organisation: string, query?: string, limit?: number): Promise<any> {
    const params = new URLSearchParams();
    params.append('organisation', organisation);
    if (query) params.append('q', query);
    if (limit) params.append('limit', limit.toString() || '20');
    return this.request('GET', `/trace/stat?${params.toString()}`);
  }
}
