import Span from "./Span";
import { Metric } from "./Dataset";

/**
 * An Example aka an Eval
 */
export default interface Example {
	id: string;
	/* matches the Spans */
	traceId?: string;
	dataset: string;
	organisation: string;
	spans?: any[]; // Note: generate-schema.js fails if this is Span[]
	/** Blank if spans are used. Alternative to Spans */
	input?: any;
	/** target good/bad outputs for similarity judgement */
	outputs: {
		good: any;
		bad: any;
	};
	created: Date;
	updated: Date;
	/** Can be blank - only needed for per-example tests, e.g. "llm:this answer should be a joke about cats" */
	metrics?: Metric[];
}