const API_BASE_URL = import.meta.env.VITE_AIQA_SERVER_URL || 'http://localhost:4001';

// Token getter function - will be set by Auth0Provider wrapper
let getAccessToken: (() => Promise<string | undefined>) | null = null;

/**
 * Set the token getter function from Auth0
 */
export function setTokenGetter(getter: () => Promise<string | undefined>) {
  getAccessToken = getter;
}

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  // Get Auth0 access token if available
  let token: string | undefined;
  if (getAccessToken) {
    try {
      token = await getAccessToken();
    } catch (error) {
      console.error('Failed to get access token:', error);
    }
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Add Authorization header with Bearer token if available
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers,
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

export async function createOrganisation(org: { name: string; members: string[] }) {
  return fetchWithAuth('/organisation', {
    method: 'POST',
    body: JSON.stringify(org),
  });
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
  return fetchWithAuth(`/input?${params.toString()}`);
}

// User endpoints
export async function getUser(id: string) {
  return fetchWithAuth(`/user/${id}`);
}

export async function getUserByEmail(email: string) {
  const query = `email:${email}`;
  return fetchWithAuth(`/user?q=${encodeURIComponent(query)}`);
}

export async function createUser(user: { email: string; name: string }) {
  return fetchWithAuth('/user', {
    method: 'POST',
    body: JSON.stringify(user),
  });
}

export async function getOrCreateUser(email: string, name: string) {
  // First, try to find the user by email
  const users = await getUserByEmail(email);
  if (Array.isArray(users) && users.length > 0) {
    return users[0];
  }
  // If not found, create a new user
  return createUser({ email, name });
}

