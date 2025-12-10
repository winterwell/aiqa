import { Span } from "../common/types";

export const getSpanId = (span: Span) => {
    return (span as any).span?.id || (span as any).client_span_id || 'N/A';
  };

  const asTime = (time: number|[number, number]|Date) => {
	if ( ! time) return null;
	if (typeof time === 'number') {
		return new Date(time);
	}
	if (Array.isArray(time)) {
		return new Date(time[0] * 1000 + time[1] / 1000000);
	}
	if (time instanceof Date) {
		return time;
	}	
	return new Date(time);
  };

export const getStartTime = (span: Span) => {
	return asTime(span.startTime);
  };

export const getEndTime = (span: Span) => {
	return asTime(span.endTime);
  };

export const getDurationMs = (span: Span): number | null => {
    const start = getStartTime(span);
    const end = getEndTime(span);
    if ( ! start || ! end) return null;
    return end.getTime() - start.getTime();
  };
