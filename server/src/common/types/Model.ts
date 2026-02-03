export default interface Model {
	id: string;
	organisation: string;
	provider: 'openai' | 'anthropic' | 'google' | 'azure' | 'bedrock' | 'other';
	/** if unset, this api-key is used for all models from the provider */
	model?: string;
	name: string;
	/** the API key. This IS stored in the database as our code needs it to run LLMs for the user */
	apiKey?: string;
	/** Display suffix for masked key (e.g. last 4 chars); some APIs return as keyEnd */
	keyEnd?: string;
	version?: string;
	description?: string;
	created: Date;
	updated: Date;
}
