const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  // In a real implementation, you'd get the auth token from Auth0
  // For now, we'll assume the API doesn't require auth for GET requests
  // POST requests that need API keys would need special handling
  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

// Organisation endpoints
export async function getOrganisation(id: string) {
  return fetchWithAuth(`/organisation/${id}`);
}

export async function listOrganisations(query?: string) {
  const url = query ? `/organisation?q=${encodeURIComponent(query)}` : '/organisation';
  return fetchWithAuth(url);
}

// Dataset endpoints
export async function getDataset(id: string) {
  return fetchWithAuth(`/dataset/${id}`);
}

export async function listDatasets(query?: string) {
  const url = query ? `/dataset?q=${encodeURIComponent(query)}` : '/dataset';
  return fetchWithAuth(url);
}

// Experiment endpoints
export async function getExperiment(id: string) {
  return fetchWithAuth(`/experiment/${id}`);
}

export async function listExperiments(query?: string) {
  const url = query ? `/experiment?q=${encodeURIComponent(query)}` : '/experiment';
  return fetchWithAuth(url);
}

// Span endpoints (require API key authentication)
// Note: These would need API key handling in a real implementation
export async function searchSpans(
  organisationId: string,
  query?: string,
  limit: number = 100,
  offset: number = 0
) {
  // In a real implementation, you'd need to get an API key for this organisation
  // For now, we'll construct the URL but note that authentication is needed
  const params = new URLSearchParams();
  if (query) params.append('q', query);
  params.append('limit', limit.toString());
  params.append('offset', offset.toString());

  // Note: This endpoint requires API key authentication
  // You'll need to implement proper auth handling
  return fetchWithAuth(`/span?${params.toString()}`, {
    headers: {
      // 'X-API-Key': apiKey, // Would need to be added
    },
  });
}

export async function searchInputs(
  organisationId: string,
  datasetId?: string,
  query?: string,
  limit: number = 100,
  offset: number = 0
) {
  const params = new URLSearchParams();
  if (query) params.append('q', query);
  if (datasetId) params.append('dataset_id', datasetId);
  params.append('limit', limit.toString());
  params.append('offset', offset.toString());

  // Note: This endpoint requires API key authentication
  return fetchWithAuth(`/input?${params.toString()}`, {
    headers: {
      // 'X-API-Key': apiKey, // Would need to be added
    },
  });
}

