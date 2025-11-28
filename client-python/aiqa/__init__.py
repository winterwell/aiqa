"""
Python client for AIQA server - OpenTelemetry tracing decorators.
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
)
from .client import get_client

__version__ = "0.2.2"

__all__ = [
    "WithTracing",
    "flush_tracing",
    "shutdown_tracing",
    "set_span_attribute",
    "set_span_name",
    "get_active_span",
    "get_provider",
    "get_exporter",
    "get_client",
    "__version__",
]

