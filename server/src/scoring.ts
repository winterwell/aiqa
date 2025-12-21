import { Metric } from './common/types/Dataset.js';
import Model from './common/types/Model.js';
import { getModel } from './db/db_sql.js';

/**
 * Score a metric based on its type.
 * TODO: Implement actual scoring logic for each metric type.
 * 
 * @param metric - The metric definition
 * @param output - The output to score
 * @param example - The example (for context, expected outputs, etc.)
 * @returns The score as a number, or null if the metric cannot be computed here
 */
export async function scoreMetric(
	organisationId: string,
  metric: Metric,
  output: any,
  example: any
): Promise<number> {
	switch (metric.type) {
    case 'javascript':
		return scoreMetricJavascript(metric, output, example);
    case 'llm':
		return scoreMetricLLM(organisationId, metric, output, example);
    case 'number':
      // TODO: For number metrics, might be a direct comparison or calculation
      // This could compare output to example.outputs.good or perform a calculation
      throw new Error('Number metric scoring not yet implemented');
    
    default:
      throw new Error(`Unknown metric type: ${(metric as any).type}`);
  }
}

/**
 * safely run a js snippet
 * @param metric 
 * @param output 
 * @param example 
 * @returns 
 */
function scoreMetricJavascript(metric: Metric, output: any, example: any): Promise<number> {
return new Promise<number>((resolve, reject) => {
	try {
		const functionBody = metric.parameters?.code || metric.parameters?.script;
		if (!functionBody) {
			return reject(new Error('No script or code found in metric.parameters'));
		}

		let finished = false;
		// Provide only output, example, and a restricted global context
		const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
 
		// Prepare our function
		let userFn: any;
		try {
			// block all IO and other dangerous functions for security
			userFn = new AsyncFunction('output', 'example', `
				"use strict";
				const global = undefined;
				const require = undefined;
				const process = undefined;
				const eval = undefined;
				const Function = undefined;
				const setTimeout = undefined;
				const setInterval = undefined;
				const fetch = undefined;
				const XMLHttpRequest = undefined;
				const File = undefined;
				const WebSocket = undefined;
				const Buffer = undefined;
				${functionBody}
			`);
		} catch (e) {
			return reject(new Error("Failed to parse script: " + (e?.message || e)));
		}

		// Handle timeout
		const timer = setTimeout(() => {
			if (!finished) {
				finished = true;
				reject(new Error('Script execution timed out'));
			}
		}, 5000);

		// Actually run the code
		Promise.resolve(userFn(output, example))
			.then((result: any) => {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				// If result is numeric, return it, else error
				const num = Number(result);
				if (!isFinite(num)) {
					return reject(new Error('Script did not return a finite number'));
				}
				resolve(num);
			})
			.catch((err: any) => {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				reject(new Error("Metric script error: " + (err?.message || err)));
			});
	} catch (err: any) {
		reject(new Error("Metric script error: " + (err?.message || err)));
	}
});

}


async function scoreMetricLLM(organisationId: string, metric: Metric, output: any, example: any): Promise<number> {
	// Get the model from metric parameters
	const modelId = metric.parameters?.model || metric.parameters?.modelId;
	if (!modelId) {
		throw new Error('LLM metric requires model or modelId in metric.parameters');
	}
	
	const model = await getModel(modelId);
	if (!model) {
		throw new Error(`Model not found: ${modelId}`);
	}
	
	if (model.organisation !== organisationId) {
		throw new Error('Model does not belong to the organisation');
	}
	
	// Build the prompt
	let prompt = metric.parameters?.prompt;
	if (!prompt) {
		// do we have good/bad targets?		
		if (example.outputs?.good || example.outputs?.bad) {
			let goodBad = [
				example.outputs?.good && 'good',
				example.outputs?.bad && 'bad'
			].filter(Boolean).join(' and ');
			prompt = `You are a tester that scores the quality of outputs.
You are given the actual output and target ${goodBad} outputs.
You need to score the output on a scale of 0 to 100.
Good output: ${JSON.stringify(example.outputs.good)}
Bad output: ${JSON.stringify(example.outputs.bad)}
Actual output: ${JSON.stringify(output)}
Respond with a number between 0 and 100.`;
		}
	}

	// Call the LLM
	const llmResult = await callLLM(model,prompt);

	// Try to extract the score from the LLM's result text
	let score = Number(llmResult.content);
	// Try to extract a number even if text has explanations, e.g. "Score: 7/10" or "7"
	if (isNaN(score)) {
		const match = llmResult.content.match(/([-+]?\d*\.?\d+)/);
		if (match) {
			score = Number(match[1]);
		}
	}
	if (!isFinite(score)) {
		throw new Error(`LLM did not return a finite score: "${llmResult.content}"`);
	}
	return score;
}

interface LLMResult {
	content: string;
}

function callLLM(model: Model, prompt: string): Promise<LLMResult> {
	switch(model.provider) {
		case 'openai':
			return callOpenAI(model, prompt);
		case 'anthropic':
			return callAnthropic(model, prompt);
		case 'google':
			return callGoogle(model, prompt);
		case 'azure':
			return callAzure(model, prompt);
		case 'bedrock':
			throw new Error('Calling Bedrock must be implemented by the caller providing a callLLM function');
		default:
			throw new Error(`Unknown model provider: ${model.provider}`);
	}
}

/**
 * Call OpenAI API
 */
async function callOpenAI(model: Model, prompt: string): Promise<LLMResult> {
	const response = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${model.api_key}`,
		},
		body: JSON.stringify({
			model: model.name,
			messages: [
				{ role: 'user', content: prompt }
			],
			temperature: 0,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
	}

	const data = await response.json() as any;
	const content = data.choices?.[0]?.message?.content;
	if (!content) {
		throw new Error('OpenAI API did not return content');
	}

	return { content };
}

/**
 * Call Anthropic API
 */
async function callAnthropic(model: Model, prompt: string): Promise<LLMResult> {
	const response = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': model.api_key,
			'anthropic-version': '2023-06-01',
		},
		body: JSON.stringify({
			model: model.name,
			max_tokens: 1024,
			temperature: 0,
			messages: [
				{ role: 'user', content: prompt }
			],
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Anthropic API error: ${response.status} ${response.statusText} - ${errorText}`);
	}

	const data = await response.json() as any;
	const content = data.content?.[0]?.text;
	if (!content) {
		throw new Error('Anthropic API did not return content');
	}

	return { content };
}

/**
 * Call Google Gemini API
 */
async function callGoogle(model: Model, prompt: string): Promise<LLMResult> {
	const modelName = model.name || 'gemini-pro';
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${model.api_key}`;
	
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			contents: [{
				parts: [{
					text: prompt
				}]
			}],
			generationConfig: {
				temperature: 0,
			},
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Google API error: ${response.status} ${response.statusText} - ${errorText}`);
	}

	const data = await response.json() as any;
	const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
	if (!content) {
		throw new Error('Google API did not return content');
	}

	return { content };
}

/**
 * Call Azure OpenAI API
 * Note: Azure requires the deployment name in the model.name field and the endpoint in model.api_key or a separate field
 * For now, we'll assume the API key contains the endpoint or it's configured separately
 */
async function callAzure(model: Model, prompt: string): Promise<LLMResult> {
	// Azure OpenAI endpoint format: https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version=2024-02-15-preview
	// For simplicity, we'll assume the endpoint is provided in an environment variable or model configuration
	// If model.api_key contains the full endpoint URL, use it; otherwise construct from model.name
	
	// Try to get endpoint from environment or use a default pattern
	const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT || `https://${model.name}.openai.azure.com`;
	const deploymentName = model.name;
	const apiVersion = '2024-02-15-preview';
	
	const url = `${azureEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
	
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'api-key': model.api_key,
		},
		body: JSON.stringify({
			messages: [
				{ role: 'user', content: prompt }
			],
			temperature: 0,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Azure OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
	}

	const data = await response.json() as any;
	const content = data.choices?.[0]?.message?.content;
	if (!content) {
		throw new Error('Azure OpenAI API did not return content');
	}

	return { content };
}
