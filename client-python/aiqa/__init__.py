"""
Python client for AIQA server - OpenTelemetry tracing decorators.

IMPORTANT: Before using any AIQA functionality, you must call get_aiqa_client() to initialize
the client and load environment variables (AIQA_SERVER_URL, AIQA_API_KEY, AIQA_COMPONENT_TAG, etc.).

Example:
    from dotenv import load_dotenv
    from aiqa import get_aiqa_client, WithTracing
    
    # Load environment variables from .env file (if using one)
    load_dotenv()
    
    # Initialize client (must be called before using WithTracing or other functions)
    get_aiqa_client()
    
    @WithTracing
    def my_function():
        return "Hello, AIQA!"
"""

from .tracing import (
    WithTracing,
    flush_tracing,
    shutdown_tracing,
    set_span_attribute,
    set_span_name,
    get_active_span,
    get_provider,
    get_exporter,
    get_trace_id,
    get_span_id,
    create_span_from_trace_id,
    inject_trace_context,
    extract_trace_context,
    set_conversation_id,
    set_component_tag,
    get_span,
)
from .client import get_aiqa_client
from .experiment_runner import ExperimentRunner

__version__ = "0.3.2"

__all__ = [
    "WithTracing",
    "flush_tracing",
    "shutdown_tracing",
    "set_span_attribute",
    "set_span_name",
    "get_active_span",
    "get_provider",
    "get_exporter",
    "get_aiqa_client",
    "ExperimentRunner",
    "get_trace_id",
    "get_span_id",
    "create_span_from_trace_id",
    "inject_trace_context",
    "extract_trace_context",
    "set_conversation_id",
    "set_component_tag",
    "get_span",
    "__version__",
]

