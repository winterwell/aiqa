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
      'Authorization': `Bearer ${this.apiKey}`,
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

  /**
   * Check whether server-aiqa accepts this credential, without doing anything
   * else with it. Used to turn away bad keys when a client connects, instead of
   * letting the connection look healthy and fail on every tool call.
   *
   * `GET /dataset` works for both API keys and JWTs, and the `organisation`
   * parameter it requires is deliberately omitted: the request is then refused
   * with 400 after authentication but before any work, which is all we need.
   *
   * So only a 401 means the credential itself was rejected. The expected 400,
   * and a 403 from a key that authenticated but lacks the role, both mean the
   * credential is real - whether it may make a particular call stays the API's
   * decision, per request.
   */
  async validateCredential(timeoutMs = 5000): Promise<'valid' | 'invalid' | 'unknown'> {
    try {
      const response = await fetch(`${this.baseUrl}/dataset?limit=1`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      return response.status === 401 ? 'invalid' : 'valid';
    } catch {
      // Unreachable or timed out, so we cannot tell. Don't claim the key is bad.
      return 'unknown';
    }
  }

  // Dataset operations
  async createDataset(dataset: {
    organisation: string;
    name: string;
    description?: string;
    tags?: string[];
    metrics?: any[];
  }): Promise<any> {
    // Server requires organisation as query parameter for POST requests
    return this.request('POST', `/dataset?organisation=${encodeURIComponent(dataset.organisation)}`, dataset);
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
    organisation?: string,
    query?: string,
    limit?: number,
    offset?: number
  ): Promise<any> {
    const params = new URLSearchParams();
    if (dataset) params.append('dataset', dataset);
    // Only read for JWT callers: for an API key the server takes the
    // organisation from the key record and ignores this.
    if (organisation) params.append('organisation', organisation);
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
