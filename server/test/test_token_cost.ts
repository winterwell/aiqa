import tap from 'tap';
import { getTokenCostEntry, calculateCost, addTokenCost } from '../dist/token_cost.js';

tap.test('getTokenCostEntry - Bedrock eu.anthropic.claude-3-5-sonnet-20240620-v1:0 uses Bedrock cost', t => {
	// No CSV row for this exact id; lookup normalizes (strip eu., -v1:0, -20240620) to match bedrock,anthropic.claude-3-5-sonnet,standard
	const entry = getTokenCostEntry('bedrock', 'eu.anthropic.claude-3-5-sonnet-20240620-v1:0', 'standard');

	t.equal(entry.provider, 'bedrock', 'should resolve to bedrock provider');
	t.equal(entry.model, 'anthropic.claude-3-5-sonnet', 'should match base model row (no extra CSV row)');
	t.equal(entry.fallback, undefined, 'should not use openai-gpt-4o fallback');
	t.equal(entry.input_Mtkn, 3.0, 'Bedrock Claude 3.5 Sonnet input rate');
	t.equal(entry.output_Mtkn, 15.0, 'Bedrock Claude 3.5 Sonnet output rate');
	t.end();
});

tap.test('getTokenCostEntry - unknown provider+model falls back to openai-gpt-4o-standard', t => {
	const entry = getTokenCostEntry('unknown', 'unknown-model-xyz', 'standard');

	t.equal(entry.provider, 'openai');
	t.equal(entry.model, 'gpt-4o');
	t.equal(entry.fallback, true, 'should be marked as fallback');
	t.end();
});

tap.test('calculateCost', t => {
	const entry = getTokenCostEntry('bedrock', 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0', 'standard');
	// OTEL: input_tokens includes cache-read tokens; uncached = 366, cache-read = 2656 → total input 3022
	const cost = calculateCost(3022, 112, 2656, 0, entry);
	t.equal(cost, 0.0035748, 'should calculate cost correctly');
	// 1M cache-write tokens: 5m rate 3.75 vs 1h rate 6.00 $/MTok
	const e45 = getTokenCostEntry('bedrock', 'anthropic.claude-sonnet-4-5', 'standard');
	t.equal(calculateCost(0, 0, 0, 1_000_000, e45, '5m'), 3.75, 'cache write 5m tier');
	t.equal(calculateCost(0, 0, 0, 1_000_000, e45, '1h'), 6.0, 'cache write 1h tier');
	t.end();
})

tap.test('addTokenCost infers bedrock when provider omitted but model is Bedrock id', t => {
	const span = {
		attributes: {
			'gen_ai.request.model': 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
			'gen_ai.usage.input_tokens': 3022,
			'gen_ai.usage.cache_read.input_tokens': 2656,
			'gen_ai.usage.output_tokens': 112,
			'gen_ai.usage.total_tokens': 3134,
		},
	} as any;
	addTokenCost(span);
	t.equal(span.attributes['gen_ai.cost.usd'], 0.0035748, 'same cost as explicit bedrock provider');
	t.equal(span.attributes['gen_ai.costcalculator'], 'bedrock-anthropic.claude-sonnet-4-5-standard');
	t.end();
});

tap.test('addTokenCost', t => {
	const span = {
		attributes: {
			'gen_ai.request.model': 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
			'gen_ai.provider.name': 'bedrock',
			'gen_ai.usage.input_tokens': 3022,
			'gen_ai.usage.cache_read.input_tokens': 2656,
			'gen_ai.usage.output_tokens': 112,
			'gen_ai.usage.total_tokens': 3134,
		},
	} as any;
	// calculate and set attributes
	addTokenCost(span);
	// $3/M uncached input, $0.30/M cache read, $15/M output — uncached 366, cache-read 2656, output 112
	// (3*366 + 2656*0.30 + 112*15)/1000000 = $0.0035748
	t.equal(span.attributes['gen_ai.cost.usd'], 0.0035748, 'should set cost attribute correctly');
	t.equal(
		span.attributes['gen_ai.costcalculator'],
		'bedrock-anthropic.claude-sonnet-4-5-standard',
		'should set cost calculator metadata'
	);
	t.end();
});