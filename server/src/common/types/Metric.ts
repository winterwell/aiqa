import { formatWithOptions } from "util";

export default interface Metric {
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
  type: 'javascript' | 'llm' | 'number' | 'contains' | 'equals' | 'not_contains' | 'not_equals' | 'similar' | 'system';
  provider?: 'openai' | 'anthropic' | 'google' | 'azure' | 'bedrock' | 'other';
  model?: string;
  /** for LLM-as-judge */
  prompt?: string;
  /** Use instead of prompt. For LLM-as-judge with the standard prompt template - this sets the core of "what criteria should the LLM judge be looking for?" */
  promptCriteria?: string;
  code?: string;
  /** for type:contains|equals|not_contains|not_equals */
  value?: string
  parameters?: Record<string, any>;
}
