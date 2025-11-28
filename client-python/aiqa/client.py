# aiqa/client.py
import os
from functools import lru_cache
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from .aiqa_exporter import AIQASpanExporter

AIQA_TRACER_NAME = "aiqa-tracer"

client = {
    "provider": None,
    "exporter": None,
}

@lru_cache(maxsize=1)
def get_client():
    global client
    _init_tracing()
    # optionally return a richer client object; for now you just need init    
    return client

def _init_tracing():
    provider = trace.get_tracer_provider()

    # If it's still the default proxy, install a real SDK provider
    if not isinstance(provider, TracerProvider):
        provider = TracerProvider()
        trace.set_tracer_provider(provider)

    # Idempotently add your processor
    _attach_aiqa_processor(provider)
    global client
    client["provider"] = provider

def _attach_aiqa_processor(provider: TracerProvider):
    # Avoid double-adding if get_client() is called multiple times
    for p in provider._active_span_processor._span_processors:
        if isinstance(getattr(p, "exporter", None), AIQASpanExporter):
            return

    exporter = AIQASpanExporter(
        server_url=os.getenv("AIQA_SERVER_URL"),
        api_key=os.getenv("AIQA_API_KEY"),
    )
    provider.add_span_processor(BatchSpanProcessor(exporter))
    global client
    client["exporter"] = exporter