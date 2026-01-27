#!/usr/bin/env python3
"""
Test tool for OpenTelemetry endpoints. Sends a test span using standard OTEL env vars.

Usage:
    export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
    export OTEL_EXPORTER_OTLP_HEADERS="Authorization=ApiKey your-key"  # optional
    export OTEL_SERVICE_NAME=test-service  # optional, default: "test-service"
    python test_otel_endpoint.py

Install: pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
"""

import os
import sys
import time
import logging
from typing import Optional

try:
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.sdk.resource import Resource
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.trace import Status, StatusCode
except ImportError as e:
    print(f"Error: Missing required package. Install with: pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http")
    sys.exit(1)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def parse_headers(headers_str: Optional[str]) -> dict:
    """Parse OTEL_EXPORTER_OTLP_HEADERS into a dictionary."""
    if not headers_str:
        return {}
    
    result = {}
    for pair in headers_str.split(','):
        pair = pair.strip()
        if '=' in pair:
            key, value = pair.split('=', 1)
            result[key.strip()] = value.strip()
    return result


def get_endpoint() -> Optional[str]:
    """Get OTLP endpoint from environment variable."""
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    if not endpoint:
        logger.error("OTEL_EXPORTER_OTLP_ENDPOINT environment variable is required")
        return None
    
    # Ensure endpoint doesn't have /v1/traces suffix (exporter adds it)
    endpoint = endpoint.rstrip('/')
    if endpoint.endswith('/v1/traces'):
        endpoint = endpoint[:-10]
    
    return endpoint


def get_timeout() -> float:
    """Get timeout from environment variable, default 10 seconds."""
    timeout_str = os.getenv("OTEL_EXPORTER_OTLP_TIMEOUT", "10")
    try:
        return float(timeout_str)
    except ValueError:
        logger.warning(f"Invalid OTEL_EXPORTER_OTLP_TIMEOUT value '{timeout_str}', using default 10.0")
        return 10.0


def get_service_name() -> str:
    """Get service name from environment variable, default 'test-service'."""
    return os.getenv("OTEL_SERVICE_NAME", "test-service")


def send_test_span() -> bool:
    """Send a test span to the OTLP endpoint."""
    endpoint = get_endpoint()
    if not endpoint:
        return False
    
    headers = parse_headers(os.getenv("OTEL_EXPORTER_OTLP_HEADERS"))
    timeout = get_timeout()
    service_name = get_service_name()
    
    logger.info(f"Configuring OTLP exporter:")
    logger.info(f"  Endpoint: {endpoint}")
    logger.info(f"  Headers: {headers if headers else '(none)'}")
    logger.info(f"  Timeout: {timeout}s")
    logger.info(f"  Service: {service_name}")
    
    try:
        # Create OTLP exporter
        exporter = OTLPSpanExporter(
            endpoint=endpoint,
            headers=headers,
            timeout=timeout,
        )
        
        # Create resource with service name
        resource = Resource.create({
            "service.name": service_name,
        })
        
        # Create tracer provider
        tracer_provider = TracerProvider(resource=resource)
        tracer_provider.add_span_processor(BatchSpanProcessor(exporter))
        
        # Set global tracer provider
        trace.set_tracer_provider(tracer_provider)
        
        # Get tracer
        tracer = trace.get_tracer(__name__)
        
        # Create and send a test span
        logger.info("Creating test span...")
        with tracer.start_as_current_span("test-span") as span:
            span.set_attribute("test.type", "otel-endpoint-test")
            span.set_attribute("test.timestamp", int(time.time()))
            span.set_attribute("test.message", "This is a test span from the OTEL endpoint test tool")
            span.set_status(Status(StatusCode.OK))
            
            # Simulate some work
            time.sleep(0.1)
            
            logger.info(f"Test span created: trace_id={format(span.get_span_context().trace_id, '032x')}, "
                       f"span_id={format(span.get_span_context().span_id, '016x')}")
        
        # Force flush to ensure span is sent
        logger.info("Flushing spans...")
        tracer_provider.force_flush(timeout=timeout)
        
        logger.info("✓ Test span sent successfully!")
        return True
        
    except Exception as e:
        logger.error(f"✗ Failed to send test span: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    finally:
        # Shutdown tracer provider
        if 'tracer_provider' in locals():
            tracer_provider.shutdown()


def main():
    """Main entry point."""
    print("OpenTelemetry Endpoint Test Tool")
    print("=" * 50)
    
    success = send_test_span()
    
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
