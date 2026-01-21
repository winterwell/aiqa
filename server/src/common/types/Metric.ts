export interface Metric {
  /** often the same as (or a prettified version of) the name */
  id: string;
  /** The display name */
  name?: string;
  description?: string;
  unit?: string;
  /**how is this metric calculated?
   * number: a number the user should calculate themselves
   * llm: LLM as judge, e.g. "this answer should be a joke about cats"
   * system: a built in metric AIQA handles eg token count, duration, etc
  */
  type: 'javascript' | 'llm' | 'number' | 'system'
  provider?: 'openai' | 'anthropic' | 'google' | 'azure' | 'bedrock' | 'other';
  model?: string;
  /** for LLM-as-judge */
  prompt?: string;
  code?: string;
  parameters?: Record<string, any>;
}

