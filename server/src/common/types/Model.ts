export default interface Model {
	id: string;
	organisation: string;
	provider: 'openai' | 'anthropic' | 'google' | 'azure' | 'bedrock' | 'other';
	/** if unset, this api-key is used for all models from the provider */
	model?: string;
	name: string;
	/** the API key. This IS stored in the database as our code needs it to run LLMs for the user */
	key?: string;
	/** Last 4 characters of the apiKey for security when returning model info */
	keyEnd?: string;
	version?: string;
	description?: string;
	created: Date;
	updated: Date;
}
