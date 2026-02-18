/**
 * OpenTelemetry semantic convention constants for GenAI attributes.
 * These follow the OpenTelemetry GenAI semantic conventions:
 * https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
 */

// Token usage attributes
export const GEN_AI_USAGE_TOTAL_TOKENS = 'gen_ai.usage.total_tokens';
export const GEN_AI_USAGE_INPUT_TOKENS = 'gen_ai.usage.input_tokens';
export const GEN_AI_USAGE_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens';
export const GEN_AI_USAGE_CACHED_INPUT_TOKENS = 'gen_ai.usage.cached_input_tokens';

// Cost attributes (non-standard)
export const GEN_AI_COST_USD = 'gen_ai.cost.usd';
export const GEN_AI_COST_CALCULATOR = 'gen_ai.costcalculator';

// Provider and model attributes
export const GEN_AI_PROVIDER_NAME = 'gen_ai.provider.name';
export const GEN_AI_REQUEST_MODEL = 'gen_ai.request.model';
export const GEN_AI_MODEL_NAME = 'gen_ai.model.name';
export const GEN_AI_REQUEST_MODE = 'gen_ai.request.mode';

// AIQA-specific attributes
/**
 * The experiment ID for the trace of an experiment running an Example.
 * This is set by the experiment runner.
 */
export const AIQA_EXPERIMENT_ID = 'aiqa.experiment';

/**
 * The example ID for the example being run by the experiment.
 * This is set by the experiment runner.
 */
export const AIQA_EXAMPLE_ID = 'aiqa.example';

/**
 * positive, negative, neutral
 */
export const FEEDBACK_VALUE = 'feedback.value';
export const GEN_AI_OPERATION_NAME = 'gen_ai.operation.name';