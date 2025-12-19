
/**
 * E.g. connection details for ChatGPT 4.1, Claude 3.5 Sonnet, etc.
 */
export default interface Model {
	id: string;
	organisation: string;
	provider: 'openai' | 'anthropic' | 'google' | 'azure' | 'bedrock' | 'other';
	/** e.g. gpt-4o This is the name as used by the provider's API */
	name: string;
	api_key: string;
	version?: string;
	description?: string;
	created: Date;
	updated: Date;
}