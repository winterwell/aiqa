export default interface Model {
	id: string;
	organisation: string;
	provider: 'openai' | 'anthropic' | 'google' | 'azure' | 'bedrock' | 'other';
	/** if unset, this api-key is used for all models from the provider */
	model?: string;
	name: string;
	/** the API key. This IS stored in the database as our code needs it to run LLMs for the user */
	apiKey?: string;
	/** Masked api key (e.g. first 4 + **** + last 4) when returning model info */
	hash?: string;
	version?: string;
	description?: string;
	created: Date;
	updated: Date;
}
