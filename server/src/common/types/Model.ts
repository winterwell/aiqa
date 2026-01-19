export default interface Model {
	id: string;
	organisation: string;
	provider: 'openai' | 'anthropic' | 'google' | 'azure' | 'bedrock' | 'other';
	name: string;
	api_key?: string;
	api_key_sig?: string;
	version?: string;
	description?: string;
	created: Date;
	updated: Date;
}
