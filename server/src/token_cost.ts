import { readFileSync } from 'fs';
import { join } from 'path';
import Span from './common/types/Span.js';
import { toNumber } from './routes/spans.js';
import {
	GEN_AI_USAGE_INPUT_TOKENS,
	GEN_AI_USAGE_OUTPUT_TOKENS,
	GEN_AI_USAGE_TOTAL_TOKENS,
	GEN_AI_USAGE_CACHED_INPUT_TOKENS,
	GEN_AI_PROVIDER_NAME,
	GEN_AI_REQUEST_MODEL,
	GEN_AI_MODEL_NAME,
	GEN_AI_REQUEST_MODE,
	GEN_AI_COST_USD,
	GEN_AI_COST_CALCULATOR,
} from './common/constants_otel.js';

interface TokenCostEntry {
	provider: string;
	model: string;
	mode: string;
	input_Mtkn: number;
	cached_input_Mtkn: number;
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
			const [provider, model, mode, input_Mtkn, cached_input_Mtkn, output_Mtkn] = line.split(',');
			if (!provider || !model || !mode) continue;

			const entry: TokenCostEntry = {
				provider: provider.trim(),
				model: model.trim(),
				mode: mode.trim(),
				input_Mtkn: parseFloat(input_Mtkn?.trim() || '0'),
				cached_input_Mtkn: parseFloat(cached_input_Mtkn?.trim() || '0'),
				output_Mtkn: parseFloat(output_Mtkn?.trim() || '0'),
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
	
	const modelLower = model.toLowerCase();
	
	// Common patterns
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
	if (modelLower.includes('bedrock') || modelLower.includes('amazon') || modelLower.includes('anthropic.claude')) {
		return 'bedrock';
	}
	
	// Check provider map from CSV
	if (providerModelMap) {
		const provider = providerModelMap.get(model);
		if (provider) return provider;
	}
	
	return null;
}

/**
 * Get token cost entry for a given provider, model, and mode
 */
function getTokenCostEntry(provider: string | null, model: string | undefined, mode: string = 'standard'): TokenCostEntry {
	const costs = loadTokenCosts();
	
	// Try exact match first
	if (provider && model) {
		const key = `${provider}-${model}-${mode}`;
		const entry = costs.get(key);
		if (entry) return entry;
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
	};
	return hardCodedEntry;
}

/**
 * Calculate cost in dollars based on token usage and cost entry
 */
function calculateCost(
	inputTokens: number,
	outputTokens: number,
	cachedInputTokens: number,
	costEntry: TokenCostEntry
): number {
	// Costs are in millions of tokens per dollar
	// So cost per token = 1 / (cost_in_Mtkn * 1,000,000)
	// Handle division by zero: if cost is 0, tokens are free
	const inputCost = (inputTokens && costEntry.input_Mtkn > 0) 
		? inputTokens / (costEntry.input_Mtkn * 1000000) 
		: 0;
	
	// Cached input: use cached rate if > 0, otherwise fall back to input rate, or 0 if both are 0
	const cachedInputMtkn = costEntry.cached_input_Mtkn > 0 
		? costEntry.cached_input_Mtkn 
		: (costEntry.input_Mtkn > 0 ? costEntry.input_Mtkn : 0);
	const cachedInputCost = (cachedInputTokens && cachedInputMtkn > 0)
		? cachedInputTokens / (cachedInputMtkn * 1000000)
		: 0;
	
	const outputCost = (outputTokens && costEntry.output_Mtkn > 0)
		? outputTokens / (costEntry.output_Mtkn * 1000000)
		: 0;
	
	return inputCost + cachedInputCost + outputCost;
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
	const cachedInputTokens = toNumber(attributes[GEN_AI_USAGE_CACHED_INPUT_TOKENS]) ?? 0;
	
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
	const model = attributes[GEN_AI_REQUEST_MODEL] as string | undefined || 
	              attributes[GEN_AI_MODEL_NAME] as string | undefined;
	const mode = attributes[GEN_AI_REQUEST_MODE] as string | undefined || "standard"; // non-standard attribute. Default to standard if not set.
	
	// If no provider, try to infer from model name
	if (!provider && model) {
		provider = inferProviderFromModel(model) || null;
	}
	
	// Get cost entry
	const costEntry = getTokenCostEntry(provider || null, model, mode);
	
	if (!costEntry) {
		// No cost entry found - log warning for debugging
		console.warn(`No cost entry found for provider="${provider || 'null'}", model="${model || 'undefined'}", mode="${mode}". Tokens present but cost not calculated.`);
		return;
	}
	
	// Calculate cost
	const cost = calculateCost(actualInputTokens, actualOutputTokens, cachedInputTokens, costEntry);
	
	// Add cost attributes (using type assertion to work around read-only interface)
	const mutableSpan = span as any;
	if (!mutableSpan.attributes) {
		mutableSpan.attributes = {};
	}
	mutableSpan.attributes[GEN_AI_COST_USD] = cost;
	
	// Add metadata about what was used for costing
	mutableSpan.attributes[GEN_AI_COST_CALCULATOR] = costEntry.provider+"-"+costEntry.model+"-"+costEntry.mode;
}
