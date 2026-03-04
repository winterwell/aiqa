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
	const cost = calculateCost(366, 112, 2656, 0, entry);
	console.log('entry', entry);
	console.log('cost', cost);
	t.equal(cost, 0.0035748, 'should calculate cost correctly');
	t.end();
})

tap.test('addTokenCost', t => {
	const span = {
		attributes: {
			'gen_ai.request.model': 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
			'gen_ai.provider.name': 'bedrock',
			'gen_ai.usage.input_tokens': 366,
			'gen_ai.usage.cache_read.input_tokens': 2656,
			'gen_ai.usage.output_tokens': 112,
			'gen_ai.usage.total_tokens': 3134,
		},
	} as any;
	// calculate and set attributes
	addTokenCost(span);
	// test the sum is correct ($3/m input tokens, $0.30/m cache read tokens, $15/m output tokens)
	// (3*366 + 2656*0.30 + 112*15)/1000000 = $0.0035748
	t.equal(span.attributes['gen_ai.cost.usd'], 0.0035748, 'should set cost attribute correctly');
	t.equal(
		span.attributes['gen_ai.costcalculator'],
		'bedrock-anthropic.claude-sonnet-4-5-standard',
		'should set cost calculator metadata'
	);
	t.end();
});