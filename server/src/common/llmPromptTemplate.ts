/**
 * Default prompt template for LLM-as-Judge metrics.
 * The {metricName} placeholder will be replaced with the actual metric name.
 */
export function getDefaultLLMPrompt(metricName: string): string {
  return `You are an LLM-as-Judge rating an AI assistant's output on the specific criteria of: ${metricName}.

Review the last assistant output, in the light of the conversation and context.
Look for:
Good things (increase the score):
- DEFINE GOOD HERE
Bad things (reduce the score):
- DEFINE BAD HERE

Example input / output: REPLACE WITH YOUR EXAMPLES
<example>
<input>
User: What is 2+2?
Assistant: 5
</input>
<output>{"score":0,"message":"The answer is wrong"}</output>
</example>

Output in json using the format: 
{score:[0,1], message:string}`;
}

