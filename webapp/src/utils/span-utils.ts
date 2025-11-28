import { Span } from "../common/types";

export const getSpanId = (span: Span) => {
    return (span as any).span?.id || (span as any).client_span_id || 'N/A';
  };

export const getStartTime = (span: Span) => {
    if (!(span as any).startTime) return null;
    return new Date((span as any).startTime[0] * 1000 + (span as any).startTime[1] / 1000000);
  };

export const getEndTime = (span: Span) => {
    if (!(span as any).endTime) return null;
    return new Date((span as any).endTime[0] * 1000 + (span as any).endTime[1] / 1000000);
  };

export const getDuration = (span: Span) => {
    if (!(span as any).startTime || !(span as any).endTime) return null;
    const start = (span as any).startTime[0] * 1000 + (span as any).startTime[1] / 1000000;
    const end = (span as any).endTime[0] * 1000 + (span as any).endTime[1] / 1000000;
    return end - start;
  };
