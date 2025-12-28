package dev.aiqa.tracing;

import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.trace.*;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.Scope;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.resources.Resource;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.SdkTracerProviderBuilder;
import io.opentelemetry.sdk.trace.export.BatchSpanProcessor;
import io.opentelemetry.semconv.ResourceAttributes;
import dev.aiqa.exporter.AIQASpanExporter;
import dev.aiqa.util.HttpClient;
import okhttp3.HttpUrl;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.Map;
import java.util.function.Function;

/**
 * OpenTelemetry tracing setup and utilities.
 * Provides automatic tracing of function calls and span management.
 */
public class Tracing {
    private static final Logger logger = LoggerFactory.getLogger(Tracing.class);
    
    private static OpenTelemetry openTelemetry;
    private static Tracer tracer;
    private static String componentTag = System.getenv("AIQA_COMPONENT_TAG");
    private static String organisationId = System.getenv("AIQA_ORGANISATION_ID");
    private static final AttributeKey<String> COMPONENT_KEY = AttributeKey.stringKey("component");
    private static final AttributeKey<String> INPUT_KEY = AttributeKey.stringKey("input");
    private static final AttributeKey<String> OUTPUT_KEY = AttributeKey.stringKey("output");

    static {
        initialize();
    }

    private static void initialize() {
        String serverUrl = System.getenv("AIQA_SERVER_URL");
        String apiKey = System.getenv("AIQA_API_KEY");
        String samplingRateStr = System.getenv("AIQA_SAMPLING_RATE");
        
        double samplingRate = 1.0;
        if (samplingRateStr != null) {
            try {
                samplingRate = Math.max(0.0, Math.min(1.0, Double.parseDouble(samplingRateStr)));
            } catch (NumberFormatException e) {
                logger.warn("Invalid AIQA_SAMPLING_RATE, using default 1.0", e);
            }
        }

        SdkTracerProviderBuilder builder = SdkTracerProvider.builder()
                .setResource(Resource.getDefault()
                        .merge(Resource.create(Attributes.of(
                                ResourceAttributes.SERVICE_NAME, "aiqa-java-client"
                        ))));

        if (serverUrl != null && !serverUrl.isEmpty()) {
            AIQASpanExporter exporter = new AIQASpanExporter(serverUrl, apiKey, 5);
            builder.addSpanProcessor(BatchSpanProcessor.builder(exporter).build());
        }

        SdkTracerProvider tracerProvider = builder.build();
        openTelemetry = OpenTelemetrySdk.builder()
                .setTracerProvider(tracerProvider)
                .build();

        tracer = openTelemetry.getTracer("aiqa-tracer");
    }

    /**
     * Get the OpenTelemetry instance
     */
    public static OpenTelemetry getOpenTelemetry() {
        return openTelemetry;
    }

    /**
     * Get the tracer instance
     */
    public static Tracer getTracer() {
        return tracer;
    }

    /**
     * Flush all pending spans to the server.
     */
    public static void flush() {
        if (openTelemetry instanceof OpenTelemetrySdk) {
            OpenTelemetrySdk sdk = (OpenTelemetrySdk) openTelemetry;
            if (sdk.getSdkTracerProvider() instanceof SdkTracerProvider) {
                ((SdkTracerProvider) sdk.getSdkTracerProvider()).forceFlush();
            }
        }
    }

    /**
     * Shutdown the tracer provider.
     */
    public static void shutdown() {
        if (openTelemetry instanceof OpenTelemetrySdk) {
            OpenTelemetrySdk sdk = (OpenTelemetrySdk) openTelemetry;
            if (sdk.getSdkTracerProvider() instanceof SdkTracerProvider) {
                ((SdkTracerProvider) sdk.getSdkTracerProvider()).shutdown();
            }
        }
    }

    /**
     * Set the component tag that will be added to all spans.
     */
    public static void setComponentTag(String tag) {
        componentTag = tag;
    }

    /**
     * Set the organisation ID that will be used for API requests.
     * This can also be set via the AIQA_ORGANISATION_ID environment variable.
     *
     * @param orgId The organisation ID
     */
    public static void setOrganisationId(String orgId) {
        organisationId = orgId;
    }

    /**
     * Get the current organisation ID.
     *
     * @return The organisation ID, or null if not set
     */
    public static String getOrganisationId() {
        return organisationId;
    }

    /**
     * Get the current trace ID as a hexadecimal string.
     */
    public static String getTraceId() {
        Span span = Span.current();
        if (span != null && span.getSpanContext().isValid()) {
            String traceId = span.getSpanContext().getTraceId();
            if (!traceId.equals("00000000000000000000000000000000")) {
                return traceId;
            }
        }
        return null;
    }

    /**
     * Get the current span ID as a hexadecimal string.
     */
    public static String getSpanId() {
        Span span = Span.current();
        if (span != null && span.getSpanContext().isValid()) {
            String spanId = span.getSpanContext().getSpanId();
            if (!spanId.equals("0000000000000000")) {
                return spanId;
            }
        }
        return null;
    }

    /**
     * Set an attribute on the active span.
     */
    public static boolean setSpanAttribute(String key, Object value) {
        Span span = Span.current();
        if (span != null) {
            span.setAttribute(AttributeKey.stringKey(key), String.valueOf(value));
            return true;
        }
        return false;
    }

    /**
     * Set the conversation ID attribute on the active span.
     */
    public static boolean setConversationId(String conversationId) {
        return setSpanAttribute("gen_ai.conversation.id", conversationId);
    }

    /**
     * Set token usage attributes on the active span.
     */
    public static boolean setTokenUsage(Integer inputTokens, Integer outputTokens, Integer totalTokens) {
        Span span = Span.current();
        if (span == null) return false;

        int setCount = 0;
        if (inputTokens != null) {
            span.setAttribute(AttributeKey.longKey("gen_ai.usage.input_tokens"), inputTokens);
            setCount++;
        }
        if (outputTokens != null) {
            span.setAttribute(AttributeKey.longKey("gen_ai.usage.output_tokens"), outputTokens);
            setCount++;
        }
        if (totalTokens != null) {
            span.setAttribute(AttributeKey.longKey("gen_ai.usage.total_tokens"), totalTokens);
            setCount++;
        }
        return setCount > 0;
    }

    /**
     * Set provider and model attributes on the active span.
     */
    public static boolean setProviderAndModel(String provider, String model) {
        Span span = Span.current();
        if (span == null) return false;

        int setCount = 0;
        if (provider != null && !provider.isEmpty()) {
            span.setAttribute(AttributeKey.stringKey("gen_ai.provider.name"), provider);
            setCount++;
        }
        if (model != null && !model.isEmpty()) {
            span.setAttribute(AttributeKey.stringKey("gen_ai.request.model"), model);
            setCount++;
        }
        return setCount > 0;
    }

    /**
     * Wrap a function to automatically create spans.
     */
    public static <T, R> Function<T, R> withTracing(String name, Function<T, R> fn) {
        return input -> {
            Span span = tracer.spanBuilder(name).startSpan();
            
            if (componentTag != null && !componentTag.isEmpty()) {
                span.setAttribute(COMPONENT_KEY, componentTag);
            }
            
            if (input != null) {
                span.setAttribute(INPUT_KEY, String.valueOf(input));
            }

            try (Scope scope = span.makeCurrent()) {
                R result = fn.apply(input);
                if (result != null) {
                    span.setAttribute(OUTPUT_KEY, String.valueOf(result));
                }
                return result;
            } catch (Throwable e) {
                span.recordException(e);
                span.setStatus(StatusCode.ERROR, e.getMessage());
                throw e;
            } finally {
                span.end();
            }
        };
    }

    /**
     * Get the current active span.
     */
    public static Span getActiveSpan() {
        return Span.current();
    }

    /**
     * Create a new span that continues from an existing trace ID.
     * This is useful for linking traces across different services or agents.
     *
     * @param traceId The trace ID as a hexadecimal string (32 characters)
     * @param parentSpanId Optional parent span ID as a hexadecimal string (16 characters)
     * @param spanName Name for the new span
     * @return A new span that continues the trace
     */
    public static Span createSpanFromTraceId(String traceId, String parentSpanId, String spanName) {
        try {
            // Parse trace ID
            TraceId traceIdObj = TraceId.fromHex(traceId);
            
            // Parse parent span ID if provided
            SpanId spanIdObj = SpanId.getInvalid();
            if (parentSpanId != null && !parentSpanId.isEmpty()) {
                spanIdObj = SpanId.fromHex(parentSpanId);
            }
            
            // Create span context
            SpanContext spanContext = SpanContext.create(
                traceIdObj,
                spanIdObj,
                TraceFlags.getSampled(),
                TraceState.getDefault()
            );
            
            // Create a context with this span context as the parent
            Context parentContext = Context.current().with(Span.wrap(spanContext));
            
            // Start a new span in this context
            Span span = tracer.spanBuilder(spanName)
                .setParent(parentContext)
                .startSpan();
            
            // Set component tag if configured
            if (componentTag != null && !componentTag.isEmpty()) {
                span.setAttribute(COMPONENT_KEY, componentTag);
            }
            
            return span;
        } catch (Exception e) {
            logger.error("Error creating span from trace_id: " + e.getMessage(), e);
            // Fallback: create a new span
            Span span = tracer.spanBuilder(spanName).startSpan();
            if (componentTag != null && !componentTag.isEmpty()) {
                span.setAttribute(COMPONENT_KEY, componentTag);
            }
            return span;
        }
    }

    /**
     * Get a span by its ID from the AIQA server.
     *
     * @param spanId The span ID as a hexadecimal string (16 characters) or client span ID
     * @return The span data as a Map, or null if not found
     * @throws IOException if the request failed
     *
     * Example:
     *   // Set organisation ID once (or via AIQA_ORGANISATION_ID environment variable)
     *   Tracing.setOrganisationId("my-org-id");
     *   
     *   Map<String, Object> span = Tracing.getSpan("abc123...");
     *   if (span != null) {
     *       System.out.println("Found span: " + span.get("name"));
     *   }
     */
    public static Map<String, Object> getSpan(String spanId) throws IOException {
        String serverUrl = System.getenv("AIQA_SERVER_URL");
        String apiKey = System.getenv("AIQA_API_KEY");
        
        if (serverUrl == null || serverUrl.isEmpty()) {
            logger.warn("AIQA_SERVER_URL is not set. Cannot retrieve span.");
            return null;
        }
        
        if (organisationId == null || organisationId.isEmpty()) {
            logger.warn("Organisation ID is required. Set it via Tracing.setOrganisationId() or AIQA_ORGANISATION_ID environment variable.");
            return null;
        }
        
        // Remove trailing slash
        serverUrl = serverUrl.replaceAll("/$", "");
        
        // Try both spanId and clientSpanId queries
        String[] queryFields = {"spanId", "clientSpanId"};
        for (String queryField : queryFields) {
            try {
                HttpClient httpClient = new HttpClient(serverUrl, apiKey);
                HttpUrl.Builder urlBuilder = httpClient.urlBuilder("/span")
                    .addQueryParameter("q", queryField + ":" + spanId)
                    .addQueryParameter("organisation", organisationId)
                    .addQueryParameter("limit", "1");
                
                Map<String, Object> response = httpClient.get(urlBuilder.build().toString(), Map.class);
                
                @SuppressWarnings("unchecked")
                java.util.List<Map<String, Object>> hits = (java.util.List<Map<String, Object>>) response.get("hits");
                if (hits != null && !hits.isEmpty()) {
                    return hits.get(0);
                }
            } catch (IOException e) {
                // Try next query field
                continue;
            }
        }
        
        return null;
    }

    /**
     * Submit feedback for a trace by creating a new span with the same trace ID.
     * This allows you to add feedback (thumbs-up, thumbs-down, comment) to a trace after it has completed.
     *
     * @param traceId The trace ID as a hexadecimal string (32 characters)
     * @param thumbsUp True for positive feedback, false for negative feedback, null for neutral
     * @param comment Optional text comment
     * @throws IllegalArgumentException if trace ID is invalid
     *
     * Example:
     *   // Submit positive feedback
     *   Tracing.submitFeedback("abc123...", true, "Great response!");
     *
     *   // Submit negative feedback
     *   Tracing.submitFeedback("abc123...", false, "Incorrect answer");
     */
    public static void submitFeedback(String traceId, Boolean thumbsUp, String comment) {
        if (traceId == null || traceId.length() != 32) {
            throw new IllegalArgumentException("Invalid trace ID: must be 32 hexadecimal characters");
        }

        // Create a span for feedback with the same trace ID
        Span span = createSpanFromTraceId(traceId, null, "feedback");
        
        try {
            // Set feedback attributes
            if (thumbsUp != null) {
                span.setAttribute(AttributeKey.booleanKey("feedback.thumbs_up"), thumbsUp);
                span.setAttribute(AttributeKey.stringKey("feedback.type"), thumbsUp ? "positive" : "negative");
            } else {
                span.setAttribute(AttributeKey.stringKey("feedback.type"), "neutral");
            }
            
            if (comment != null && !comment.isEmpty()) {
                span.setAttribute(AttributeKey.stringKey("feedback.comment"), comment);
            }
            
            // Mark as feedback span
            span.setAttribute(AttributeKey.stringKey("aiqa.span_type"), "feedback");
        } finally {
            // End the span
            span.end();
            
            // Flush to ensure it's sent immediately
            flush();
        }
    }
}

