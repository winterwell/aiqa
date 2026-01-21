export default interface Model {
	id: string;
	organisation: string;
	provider: 'openai' | 'anthropic' | 'google' | 'azure' | 'bedrock' | 'other';
	/** if unset, this api-key is used for all models from the provider */
	model?: string;
	name: string;
	api_key?: string;
	api_key_sig?: string;
	version?: string;
	description?: string;
	created: Date;
	updated: Date;
}
