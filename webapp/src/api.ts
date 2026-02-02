import Span from "./common/types/Span.js";
import { getTraceId } from "./common/types/Span.js";

export const API_BASE_URL = import.meta.env.VITE_AIQA_SERVER_URL || 'http://localhost:4318';

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

export async function updateOrganisation(id: string, updates: Partial<{
	name?: string;
	members?: string[];
	pending_members?: string[];
	member_settings?: Record<string, { role: 'admin' | 'standard' }>;
}>) {
	return fetchWithAuth(`/organisation/${id}`, {
		method: 'PUT',
		body: JSON.stringify(updates),
	});
}

/** Add member by email: server looks up user (case-insensitive) and adds to members or pending. */
export async function addOrganisationMemberByEmail(organisationId: string, email: string) {
	return fetchWithAuth(`/organisation/${organisationId}/member`, {
		method: 'POST',
		body: JSON.stringify({ email: email.trim() }),
	});
}

// OrganisationAccount endpoints
export async function getOrganisationAccount(organisationId: string) {
	return fetchWithAuth(`/organisation/${organisationId}/account`);
}

export async function updateOrganisationAccount(id: string, updates: Partial<{
	subscription?: {
		type?: 'free' | 'trial' | 'pro' | 'enterprise';
		status?: string;
		start_date?: Date | string;
		end_date?: Date | string | null;
		renewal_date?: Date | string | null;
		price_per_month?: number;
		currency?: 'USD' | 'EUR' | 'GBP';
	};
	stripe_customer_id?: string;
	stripe_subscription_id?: string;
	rate_limit_per_hour?: number;
	retention_period_days?: number;
	max_members?: number;
	max_datasets?: number;
	experiment_retention_days?: number;
	max_examples_per_dataset?: number;
}>) {
	return fetchWithAuth(`/organisation-account/${id}`, {
		method: 'PUT',
		body: JSON.stringify(updates),
	});
}

// Subscription endpoints
export async function createCheckoutSession(organisationId: string, planType: 'free' | 'pro' | 'enterprise') {
	return fetchWithAuth(`/organisation/${organisationId}/subscription/checkout`, {
		method: 'POST',
		body: JSON.stringify({ planType }),
	});
}

export async function updateSubscription(
	organisationId: string,
	planType: 'free' | 'pro' | 'enterprise',
	noPaymentNeeded?: boolean,
	pricePerMonth?: number
) {
	return fetchWithAuth(`/organisation/${organisationId}/subscription/update`, {
		method: 'POST',
		body: JSON.stringify({ planType, noPaymentNeeded, pricePerMonth }),
	});
}

export async function getCustomerPortalUrl(organisationId: string) {
	return fetchWithAuth(`/organisation/${organisationId}/subscription/portal`);
}

// Dataset endpoints
export async function getDataset(id: string) {
	return fetchWithAuth(`/dataset/${id}`);
}

export async function listDatasets(organisationId: string, query?: string) {
	const params = new URLSearchParams();
	addOrganisationParam(params, organisationId);
	if (query) params.append('q', query);
	return fetchWithAuth(`/dataset?${params.toString()}`);
}

export async function createDataset(dataset: {
	organisation: string;
	name: string;
	description?: string;
	tags?: string[];
	input_schema?: any;
	output_schema?: any;
	metrics?: any;
}) {
	return fetchWithAuth('/dataset?organisation=' + dataset.organisation, {
		method: 'POST',
		body: JSON.stringify(dataset),
	});
}

export async function updateDataset(id: string, updates: Partial<{
	name?: string;
	description?: string;
	tags?: string[];
	input_schema?: any;
	output_schema?: any;
	metrics?: any;
}>) {
	return fetchWithAuth(`/dataset/${id}`, {
		method: 'PUT',
		body: JSON.stringify(updates),
	});
}

// Experiment endpoints
export async function getExperiment(id: string) {
	return fetchWithAuth(`/experiment/${id}`);
}

export async function listExperiments(organisationId: string, query?: string) {
	const params = new URLSearchParams();
	addOrganisationParam(params, organisationId);
	if (query) params.append('q', query);
	return fetchWithAuth(`/experiment?${params.toString()}`);
}

export async function createExperiment(experiment: {
	organisation: string;
	dataset_id: string;
	summary_results?: any;
}) {
	return fetchWithAuth('/experiment', {
		method: 'POST',
		body: JSON.stringify(experiment),
	});
}

export async function deleteExperiment(id: string) {
	return fetchWithAuth(`/experiment/${id}`, {
		method: 'DELETE',
	});
}

function addOrganisationParam(params: URLSearchParams, organisationId: string) {
	params.append('organisation', organisationId);
}

// Span endpoints
export async function searchSpans(args: {
	organisationId: string;
	isRoot?: boolean;
	query?: string;
	limit?: number;
	offset?: number;
	fields?: string; // Comma-separated list of fields, or '*' for all fields including attributes
	exclude?: string; // Comma-separated list of fields to exclude (e.g., 'attributes.input,attributes.output')
}) {
	let { organisationId, isRoot = false, query, limit = 100, offset = 0, fields, exclude } = args;
	// In a real implementation, you'd need to get an API key for this organisation
	// For now, we'll construct the URL but note that authentication is needed
	const params = new URLSearchParams();
	addOrganisationParam(params, organisationId);
	if (isRoot) {
		if (!query) query = 'parent_span_id:unset';
		else query = `(${query}) AND parent_span_id:unset`;
	}
	if (query) params.append('q', query);
	params.append('limit', limit.toString());
	params.append('offset', offset.toString());
	if (fields) params.append('fields', fields);
	if (exclude) params.append('exclude', exclude);

	// Note: This endpoint requires API key authentication
	// You'll need to implement proper auth handling
	return fetchWithAuth(`/span?${params.toString()}`, {
		headers: {
			// 'X-API-Key': apiKey, // Would need to be added
		},
	});
}

export async function updateSpan(spanId: string, updates: { starred?: boolean; tags?: string[] }) {
	return fetchWithAuth(`/span/${encodeURIComponent(spanId)}`, {
		method: 'PUT',
		body: JSON.stringify(updates),
	});
}

export async function deleteSpans(options: { spanIds: string[] } | { trace_ids: string[] }) {
	return fetchWithAuth('/span', {
		method: 'DELETE',
		body: JSON.stringify(options),
	});
}

/** common base function for create example from input | span */
async function _createExample(organisationId: string, datasetId: string, exampleData: Partial<any>) {
	const example = {
		id: crypto.randomUUID(),
		dataset: datasetId,
		organisation: organisationId,
		created: new Date(),
		updated: new Date(),
		...exampleData,
	};

	const params = new URLSearchParams();
	addOrganisationParam(params, organisationId);
	params.append('dataset', datasetId);

	return fetchWithAuth(`/example?${params.toString()}`, {
		method: 'POST',
		body: JSON.stringify(example),
	});
}

export async function createExampleFromSpans(args: {
	organisationId:string,
	datasetId:string,
	spans:Span[]
}) {
	const {organisationId, datasetId, spans} = args;
	const traceId = getTraceId(spans[0]);
	// Spans will be cleaned server-side
	return _createExample(organisationId, datasetId, {
		trace_id: traceId,
		spans: spans,
	});
}

export async function createExampleFromInput(args: {
	organisationId: string;
	datasetId: string;
	input?: any;
	tags?: string[];
}) {
	const { organisationId, datasetId, input, tags } = args;
	return _createExample(organisationId, datasetId, {
		input: input,
		tags: tags,
		outputs: {
			good: null,
			bad: null,
		},
	});
}


export async function searchExamples(
	args: {
		organisationId: string;
		datasetId?: string;
		query?: string;
		limit?: number;
		offset?: number;
	}
) {
	const { organisationId, datasetId, query, limit = 100, offset = 0 } = args;
	const params = new URLSearchParams();
	addOrganisationParam(params, organisationId);
	if (query) params.append('q', query);
	if (datasetId) params.append('dataset', datasetId);
	params.append('limit', limit.toString());
	params.append('offset', offset.toString());

	// Note: This endpoint requires API key authentication
	return fetchWithAuth(`/example?${params.toString()}`);
}

export async function getExample(organisationId: string, exampleId: string) {
	const params = new URLSearchParams();
	addOrganisationParam(params, organisationId);
	return fetchWithAuth(`/example/${encodeURIComponent(exampleId)}?${params.toString()}`);
}

export async function updateExample(organisationId: string, exampleId: string, updates: Partial<{
	tags?: string[];
	metrics?: any[];
}>) {
	const params = new URLSearchParams();
	addOrganisationParam(params, organisationId);
	return fetchWithAuth(`/example/${encodeURIComponent(exampleId)}?${params.toString()}`, {
		method: 'PUT',
		body: JSON.stringify(updates),
	});
}

export async function deleteExample(organisationId: string, exampleId: string) {
	const params = new URLSearchParams();
	addOrganisationParam(params, organisationId);
	return fetchWithAuth(`/example/${encodeURIComponent(exampleId)}?${params.toString()}`, {
		method: 'DELETE',
	});
}

// User endpoints
// export async function getUser(id: string) {
// 	return fetchWithAuth(`/user/${id}`);
// }

export async function getUserByJWT() {
	return fetchWithAuth(`/user/jwt`);
}

export async function getUser(id: string) {
	return fetchWithAuth(`/user/${id}`);
}

export async function createUser(user: { email: string; name: string }) {
	return fetchWithAuth('/user', {
		method: 'POST',
		body: JSON.stringify(user),
	});
}

/**
 * Relying on fetchWithAuth to add JWT token -- get/create user
 * @param email Set the email if making a new user
 * @param name Set the name if making a new user
 * @returns 
 */
export async function getOrCreateUser(email: string, name: string) {
	console.log("getOrCreateUser: "+email+" "+name);
	// First, try to find the user by email
	try {
		const user = await getUserByJWT();
		if (user) {
			console.log("user found: "+user.id);
			return user;
		}
	} catch (error) {
		console.log("Error getting user by JWT:", error);
	}
	// If not found, create a new user
	console.log("creating new user: "+email+" "+name);
	return createUser({ email, name});
}

export async function listUsers(query?: string) {
	const url = query ? `/user?q=${encodeURIComponent(query)}` : '/user';
	return fetchWithAuth(url);
}


// API Key endpoints
export async function listApiKeys(organisationId: string, query?: string) {
	const params = new URLSearchParams();
	addOrganisationParam(params, organisationId);
	if (query) params.append('q', query);
	return fetchWithAuth(`/api-key?${params.toString()}`);
}

/**
 * Hash an API key using SHA256.
 */
async function hashApiKey(key: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(key);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function createApiKey(apiKey: {
	organisation: string;
	name?: string;
	key_hash: string;
	key_end?: string;
	rate_limit_per_hour?: number;
	retention_period_days?: number;
	role?: 'trace' | 'developer' | 'admin';
}) {
	return fetchWithAuth('/api-key', {
		method: 'POST',
		body: JSON.stringify(apiKey),
	});
}

export async function updateApiKey(id: string, updates: {
	name?: string;
	rate_limit_per_hour?: number;
	retention_period_days?: number;
	role?: 'trace' | 'developer' | 'admin';
}) {
	return fetchWithAuth(`/api-key/${id}`, {
		method: 'PUT',
		body: JSON.stringify(updates),
	});
}

export async function deleteApiKey(id: string) {
	return fetchWithAuth(`/api-key/${id}`, {
		method: 'DELETE',
	});
}

// Model endpoints
export async function listModels(organisationId: string, query?: string, includeApiKey?: boolean) {
	const params = new URLSearchParams();
	addOrganisationParam(params, organisationId);
	if (query) params.append('q', query);
	if (includeApiKey) params.append('fields', 'api_key');
	return fetchWithAuth(`/model?${params.toString()}`);
}

export async function getModel(id: string, includeApiKey?: boolean) {
	const params = new URLSearchParams();
	if (includeApiKey) params.append('fields', 'api_key');
	const queryString = params.toString();
	return fetchWithAuth(`/model/${id}${queryString ? `?${queryString}` : ''}`);
}

export async function createModel(organisationId: string, model: {
	provider: 'openai' | 'anthropic' | 'google' | 'azure' | 'bedrock' | 'other';
	name: string;
	api_key: string;
	version?: string;
	description?: string;
}) {
	const params = new URLSearchParams();
	addOrganisationParam(params, organisationId);
	return fetchWithAuth(`/model?${params.toString()}`, {
		method: 'POST',
		body: JSON.stringify(model),
	});
}

export async function deleteModel(id: string) {
	return fetchWithAuth(`/model/${id}`, {
		method: 'DELETE',
	});
}

// Version endpoint (public, no auth required)
export async function getVersion() {
	// Use regular fetch since version endpoint doesn't require auth
	const url = `${API_BASE_URL}/version`;
	console.log('[getVersion] Fetching from:', url);
	const response = await fetch(url);
	if (!response.ok) {
		console.error('[getVersion] Error:', response.status, response.statusText);
		throw new Error(`HTTP error! status: ${response.status}`);
	}
	const data = await response.json();
	console.log('[getVersion] Received:', data);
	return data;
}

// Webapp version endpoint (public, no auth required)
export async function getWebappVersion() {
	const url = '/.well-known/version.json';
	console.log('[getWebappVersion] Fetching from:', url);
	const response = await fetch(url);
	if (!response.ok) {
		console.error('[getWebappVersion] Error:', response.status, response.statusText);
		throw new Error(`HTTP error! status: ${response.status}`);
	}
	const data = await response.json();
	console.log('[getWebappVersion] Received:', data);
	return data;
}

