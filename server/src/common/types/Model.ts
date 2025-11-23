
/**
 * E.g. connection details for ChatGPT 4.1, Claude 3.5 Sonnet, etc.
 */
export interface Model {
	id: string;
	organisation_id: string;
	name: string;
	api_key: string;
	version?: string;
	description?: string;
	created: Date;
	updated: Date;
}