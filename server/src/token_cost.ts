import { readFileSync } from 'fs';
import { join } from 'path';
import Span from './common/types/Span.js';
import { toNumber } from './routes/server-span-utils.js';
import {
	GEN_AI_USAGE_INPUT_TOKENS,
	GEN_AI_USAGE_OUTPUT_TOKENS,
	GEN_AI_USAGE_TOTAL_TOKENS,
	GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
	GEN_AI_PROVIDER_NAME,
	GEN_AI_REQUEST_MODEL,
	GEN_AI_REQUEST_MODE,
	GEN_AI_COST_USD,
	GEN_AI_COST_CALCULATOR,
	GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
	GEN_AI_USAGE_CACHE_WRITE_TTL,
} from './common/constants_otel.js';

interface TokenCostEntry {
	provider: string;
	model: string;
	mode: string;
	input_Mtkn: number;
	cached_input_Mtkn: number;
	/** Prompt cache write, 1-hour TTL ($/1M tokens). */
	cache_creation_input_1h_Mtkn: number;
	/** Prompt cache write, 5-minute TTL ($/1M tokens). */
	cache_creation_input_5m_Mtkn: number;
	output_Mtkn: number;
	/** if true, this is a bland guess */
	fallback?: boolean;
}

// Cache for loaded token costs
let tokenCostsCache: Map<string, TokenCostEntry> | null = null;
let providerModelMap: Map<string, string> | null = null;

/**
 * Load token costs from CSV file and cache them
 */
function loadTokenCosts(): Map<string, TokenCostEntry> {
	if (tokenCostsCache) {
		return tokenCostsCache;
	}

	// Resolve path relative to the server directory (one level up from src)
	const csvPath = join(process.cwd(), 'token_costs.csv');
	const tokenCostsMap = new Map<string, TokenCostEntry>();
	const providerMap = new Map<string, string>();

	try {
		const csvContent = readFileSync(csvPath, 'utf8');
		const lines = csvContent.split('\n').filter(line => line.trim() && !line.startsWith('provider'));

		for (const line of lines) {
			// skip comment lines and empty lines
			if (line.trim() === '' || line.startsWith('#')) continue;
			const [provider, model, mode, input_Mtkn, cached_input_Mtkn, output_Mtkn, c1h, c5m] = line.split(',');
			if (!provider || !model || !mode) continue;

			const entry: TokenCostEntry = {
				provider: provider.trim(),
				model: model.trim(),
				mode: mode.trim(),
				input_Mtkn: parseFloat(input_Mtkn?.trim() || '0'),
				cached_input_Mtkn: parseFloat(cached_input_Mtkn?.trim() || '0'),
				output_Mtkn: parseFloat(output_Mtkn?.trim() || '0'),
				cache_creation_input_1h_Mtkn: parseFloat(c1h?.trim() || '0'),
				cache_creation_input_5m_Mtkn: parseFloat(c5m?.trim() || '0'),
			};

			// Store by provider-model-mode key
			const key = `${entry.provider}-${entry.model}-${entry.mode}`;
			tokenCostsMap.set(key, entry);

			// Build provider lookup map (model -> provider) for fallback
			if (!providerMap.has(entry.model)) {
				providerMap.set(entry.model, entry.provider);
			}
		}
	} catch (error) {
		console.error('Failed to load token costs:', error);
		// Return empty map on error - will fall back to default
	}

	tokenCostsCache = tokenCostsMap;
	providerModelMap = providerMap;
	return tokenCostsMap;
}

/**
 * Infer provider from model name
 */
function inferProviderFromModel(model: string | undefined): string | null {
	if (!model) return null;

	loadTokenCosts();

	const modelLower = model.toLowerCase();

	// Bedrock before generic "claude". Direct Anthropic API uses names like claude-3-5-sonnet-20241022 (no "anthropic.");
	// Bedrock uses anthropic.claude-… and eu.anthropic.claude-…. Require that prefix so we do not match arbitrary strings that merely contain the substring "anthropic.claude".
	if (
		modelLower.includes('bedrock') ||
		/^(?:[a-z]{2}\.)?anthropic\.claude-/i.test(model.trim()) ||
		/^[a-z]{2}\.(amazon\.|ai21\.|cohere\.|meta\.|mistral\.)/i.test(model.trim())
	) {
		return 'bedrock';
	}

	if (modelLower.includes('gpt') || modelLower.includes('o1') || modelLower.includes('o3') || modelLower.includes('o4')) {
		return 'openai';
	}
	if (modelLower.includes('claude')) {
		return 'anthropic';
	}
	if (modelLower.includes('gemini')) {
		return 'google';
	}
	if (modelLower.includes('azure')) {
		return 'azure';
	}
	
	// Check provider map from CSV
	if (providerModelMap) {
		const provider = providerModelMap.get(model);
		if (provider) return provider;
	}
	
	return null;
}

/**
 * Get possible model keys to try for lookup, in priority order.
 *
 * For most providers this is just the raw `model`.
 *
 * For Bedrock we generate a small set of normalized variants:
 * - raw ID
 * - without region prefix (e.g. `eu.`)
 * - additionally without version suffix (e.g. `-v1:0`)
 * - additionally without date suffix (e.g. `-20240620`)
 *
 * This lets variants like
 *   eu.anthropic.claude-3-5-sonnet-20240620-v1:0
 * match base CSV rows such as
 *   bedrock,anthropic.claude-3-5-sonnet,standard,...
 */
function getModelKeysForLookup(provider: string | null, model: string | undefined): string[] {
	if (!model) return [];
	if (provider !== 'bedrock') return [model];

	const keys = new Set<string>();
	keys.add(model);

	// Bedrock model IDs can be "eu.anthropic.claude-3-5-sonnet-20240620-v1:0"
	// -> try without region, version suffix, and date suffix.
	const withoutRegion = model.replace(/^[a-z]{2}\.(?=anthropic\.|amazon\.|ai21\.|cohere\.|meta\.|mistral\.)/i, '');
	keys.add(withoutRegion);

	const withoutVersion = withoutRegion.replace(/-v\d+:\d+$/, '');
	keys.add(withoutVersion);

	const withoutDate = withoutVersion.replace(/-\d{8}(?=$)/, '');
	keys.add(withoutDate);

	return Array.from(keys);
}

/**
 * Get token cost entry for a given provider, model, and mode.
 * Exported for unit tests.
 */
export function getTokenCostEntry(provider: string | null, model: string | undefined, mode: string = 'standard'): TokenCostEntry {
	const costs = loadTokenCosts();
	
	// Try a small set of candidate model keys (for Bedrock region/version/date variants)
	if (provider && model) {
		for (const tryModel of getModelKeysForLookup(provider, model)) {
			if (!tryModel) continue;
			const key = `${provider}-${tryModel}-${mode}`;
			const entry = costs.get(key);
			if (entry) return entry;
		}
	}
	
	// Fallback to gpt-4o standard
	const fallbackKey = 'openai-gpt-4o-standard';
	const fallback = costs.get(fallbackKey);
	if (fallback) {
		return {
			...fallback,
			fallback: true,
		};
	}
	const hardCodedEntry : TokenCostEntry = {
		fallback: true,
		provider: 'openai',
		model: 'gpt-4o',
		mode: 'standard',
		input_Mtkn: 2.50,
		cached_input_Mtkn: 1.25,
		output_Mtkn: 10.00,
		cache_creation_input_1h_Mtkn: 0.00,
		cache_creation_input_5m_Mtkn: 0.00,
	};
	return hardCodedEntry;
}

function cacheCreationRatePerMtkn(entry: TokenCostEntry, ttl: '1h' | '5m'): number {
	const r1h = entry.cache_creation_input_1h_Mtkn;
	const r5m = entry.cache_creation_input_5m_Mtkn;
	if (ttl === '1h' && r1h > 0) return r1h;
	if (ttl === '5m' && r5m > 0) return r5m;
	return r5m || r1h || 0;
}

/**
 * Calculate cost in dollars based on token usage and cost entry
 *
 * Token semantics:
 * - gen_ai.usage.input_tokens SHOULD include cached input tokens (OpenTelemetry spec).
 * - For OpenAI, `prompt_tokens` already includes cached tokens, and cached tokens are
 *   exposed separately via `prompt_tokens_details.cached_tokens`.
 *   See https://platform.openai.com/docs/guides/prompt-caching and
 *   https://platform.openai.com/docs/api-reference/chat/object#chat/object/usage.
 * - For Bedrock, `inputTokens` excludes `cacheReadInputTokens`, so we rely on the client
 *   to set:
 *     gen_ai.usage.input_tokens = inputTokens + cacheReadInputTokens
 *     gen_ai.usage.cache_read.input_tokens = cacheReadInputTokens
 *     gen_ai.usage.cache_creation.input_tokens = cacheCreationInputTokens
 *   See https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_TokenUsage.html.
 *
 * This function assumes:
 * - `inputTokens` may already include cached tokens (OpenAI or client-adjusted Bedrock).
 * - `cachedInputTokens` is the subset of input tokens that came from cache reads.
 *
 * Prompt cache **creation** uses `cache_write_1h_Mtkn` vs `cache_write_5m_Mtkn` from the CSV;
 * `cacheWriteTtl` picks the tier (default `5m`). Spans may set {@link GEN_AI_USAGE_CACHE_WRITE_TTL}
 * to `1h` when the provider used a 1-hour cache TTL.
 */
// exported for unit tests
export function calculateCost(
	inputTokens: number,
	outputTokens: number,
	cachedInputTokens: number,
	cacheCreationTokens: number,
	costEntry: TokenCostEntry,
	cacheWriteTtl: '1h' | '5m' = '5m',
): number {
	// Costs are in dollars per million tokens.
	// So cost per token = cost_in_Mtkn / 1,000,000.
	// Handle zero rates: if cost is 0, those tokens are free.
	// Cached tokens and input:
	// - OTEL standard says: input tokens SHOULD include cached input tokens.
	// - We assume `inputTokens` includes both cached and uncached input.
	//   So uncachedInputTokens = inputTokens - cachedInputTokens, clamped at 0.
	let uncachedInputTokens = inputTokens;
	if (inputTokens !== undefined && cachedInputTokens !== undefined) {
		uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
	}
	const inputCost = (uncachedInputTokens && costEntry.input_Mtkn > 0)
		? (uncachedInputTokens * costEntry.input_Mtkn) / 1_000_000
		: 0;
	
	// Cached input: use cached rate if > 0, otherwise fall back to input rate, or 0 if both are 0
	const cachedInputMtkn = costEntry.cached_input_Mtkn > 0
		? costEntry.cached_input_Mtkn
		: (costEntry.input_Mtkn > 0 ? costEntry.input_Mtkn : 0);
	const cachedInputCost = (cachedInputTokens && cachedInputMtkn > 0)
		? (cachedInputTokens * cachedInputMtkn) / 1_000_000
		: 0;
	const cacheMtkn = cacheCreationRatePerMtkn(costEntry, cacheWriteTtl);
	const cacheCreationCost = (cacheCreationTokens && cacheMtkn > 0)
		? (cacheCreationTokens * cacheMtkn) / 1_000_000
		: 0;
	// output
	const outputCost = (outputTokens && costEntry.output_Mtkn > 0)
		? (outputTokens * costEntry.output_Mtkn) / 1_000_000
		: 0;
	
	return inputCost + cachedInputCost + cacheCreationCost + outputCost;
}

/**
 * Add token cost to a span based on its token usage attributes
 */
export function addTokenCost(span: Span): void {
	const attributes = span.attributes || {};
	
	// Get token usage - use toNumber without default to handle string values and distinguish undefined from 0
	const inputTokens = toNumber(attributes[GEN_AI_USAGE_INPUT_TOKENS]);
	const outputTokens = toNumber(attributes[GEN_AI_USAGE_OUTPUT_TOKENS]);
	const totalTokens = toNumber(attributes[GEN_AI_USAGE_TOTAL_TOKENS]);
	const cachedInputTokens = toNumber(attributes[GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]) ?? 0;
	const cacheCreationTokens = toNumber(attributes[GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS]) ?? 0;
	const cacheWriteTtlRaw = attributes[GEN_AI_USAGE_CACHE_WRITE_TTL] as string | undefined;
	const cacheWriteTtl: '1h' | '5m' = cacheWriteTtlRaw === '1h' ? '1h' : '5m';
	// If no token usage at all, return early
	if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
		return;
	}
	
	// Calculate actual input/output tokens
	let actualInputTokens = inputTokens ?? 0;
	let actualOutputTokens = outputTokens ?? 0;
	
	// If only total_tokens is provided, treat as 50% input, 50% output
	if (inputTokens === undefined && outputTokens === undefined && totalTokens !== undefined) {
		actualInputTokens = Math.floor(totalTokens / 2);
		actualOutputTokens = totalTokens - actualInputTokens;
	} else if (totalTokens !== undefined) {
		// If we have both total and individual, use individual but validate
		if (inputTokens === undefined) {
			actualInputTokens = Math.max(0, totalTokens - (outputTokens ?? 0));
		}
		if (outputTokens === undefined) {
			actualOutputTokens = Math.max(0, totalTokens - (inputTokens ?? 0));
		}
	}
	
	// Get provider and model from span attributes
	// attributes are from: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
	let provider = attributes[GEN_AI_PROVIDER_NAME] as string | undefined;
	const model = attributes[GEN_AI_REQUEST_MODEL] as string | undefined;
	const mode = attributes[GEN_AI_REQUEST_MODE] as string | undefined || "standard"; // non-standard attribute. Default to standard if not set.
	
	// If no provider, try to infer from model name
	if (!provider && model) {
		provider = inferProviderFromModel(model) || null;
	}
	
	const costEntry = getTokenCostEntry(provider || null, model, mode);

	const cost = calculateCost(actualInputTokens, actualOutputTokens, cachedInputTokens, cacheCreationTokens, costEntry, cacheWriteTtl);
	
	// Add cost attributes (using type assertion to work around read-only interface)
	const mutableSpan = span as any;
	if (!mutableSpan.attributes) {
		mutableSpan.attributes = {};
	}
	mutableSpan.attributes[GEN_AI_COST_USD] = cost;
	
	// Add metadata about what was used for costing
	mutableSpan.attributes[GEN_AI_COST_CALCULATOR] = costEntry.provider+"-"+costEntry.model+"-"+costEntry.mode;
}
