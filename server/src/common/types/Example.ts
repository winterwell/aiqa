import Span from "./Span";
import { Metric } from "./Metric.js";

/**
 * An Example aka an Eval
 */
export default interface Example {
	id: string;
	/* If created from spans */
	trace_id?: string;
	dataset: string;
	organisation: string;
	name?: string;
	tags?: string[];
	/** blank if input is used 
	 * spans is a way to provide the input for running this example,
	 * by copying from a trace. This is convenient for creating real examples
	 * from actual usage. Example.spans is not for tracing, and the spans are stripped
	 * down to name, id, input, and tree-structure (parent_span_id)
	*/
	spans?: any[]; // Note: generate-schema.js fails if this is Span[]
	/** Blank if spans are used. Alternative to Spans */
	input?: any;
	/** example target good/bad outputs for similarity judgement. 
	*/
	outputs?: {
		good: any;
		bad: any;
	};
	/** Can be blank - only needed for per-example tests, e.g. "llm:this answer should be a joke about cats" */
	metrics?: Metric[];
	created: Date;
	updated: Date;
}