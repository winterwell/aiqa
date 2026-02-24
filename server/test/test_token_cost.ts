import tap from 'tap';
import { getTokenCostEntry } from '../dist/token_cost.js';

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
