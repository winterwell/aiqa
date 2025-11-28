"""
OpenTelemetry tracing setup and utilities. Initializes tracer provider on import.
Provides WithTracing decorator to automatically trace function calls.
"""

import os
import json
import logging
import inspect
from typing import Any, Callable, Optional, Dict
from functools import wraps
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ALWAYS_ON
from opentelemetry.sdk.resources import Resource
from opentelemetry.semconv.resource import ResourceAttributes
from opentelemetry.trace import Status, StatusCode
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from .aiqa_exporter import AIQASpanExporter
from .client import get_client, AIQA_TRACER_NAME

logger = logging.getLogger(__name__)


async def flush_tracing() -> None:
    """
    Flush all pending spans to the server.
    Flushes also happen automatically every few seconds. So you only need to call this function
    if you want to flush immediately, e.g. before exiting a process.

    This flushes both the BatchSpanProcessor and the exporter buffer.
    """
    client = get_client()
    if client.get("provider"):
        client["provider"].force_flush()  # Synchronous method
    if client.get("exporter"):    
        await client["exporter"].flush()


async def shutdown_tracing() -> None:
    """
    Shutdown the tracer provider and exporter.
    It is not necessary to call this function.
    """
    try:
        client = get_client()
        if client.get("provider"):
            client["provider"].shutdown()  # Synchronous method
        if client.get("exporter"):
            client["exporter"].shutdown()  # Synchronous method
    except Exception as e:
        logger.error(f"Error shutting down tracing: {e}", exc_info=True)


# Export provider and exporter accessors for advanced usage

__all__ = ["get_provider", "get_exporter", "flush_tracing", "shutdown_tracing", "WithTracing", "set_span_attribute", "set_span_name", "get_active_span"]


class TracingOptions:
    """Options for WithTracing decorator"""

    def __init__(
        self,
        name: Optional[str] = None,
        ignore_input: Optional[Any] = None,
        ignore_output: Optional[Any] = None,
        filter_input: Optional[Callable[[Any], Any]] = None,
        filter_output: Optional[Callable[[Any], Any]] = None,
    ):
        self.name = name
        self.ignore_input = ignore_input
        self.ignore_output = ignore_output
        self.filter_input = filter_input
        self.filter_output = filter_output


def _serialize_for_span(value: Any) -> Any:
    """
    Serialize a value for span attributes.
    OpenTelemetry only accepts primitives (bool, str, bytes, int, float) or sequences of those.
    Complex types (dicts, lists, objects) are converted to JSON strings.
    """
    # Keep primitives as is (including None)
    if value is None or isinstance(value, (str, int, float, bool, bytes)):
        return value
    
    # For sequences, check if all elements are primitives
    if isinstance(value, (list, tuple)):
        # If all elements are primitives, return as list
        if all(isinstance(item, (str, int, float, bool, bytes, type(None))) for item in value):
            return list(value)
        # Otherwise serialize to JSON string
        try:
            return json.dumps(value)
        except (TypeError, ValueError):
            return str(value)
    
    # For dicts and other complex types, serialize to JSON string
    try:
        return json.dumps(value)
    except (TypeError, ValueError):
        # If JSON serialization fails, convert to string
        return str(value)


def _prepare_input(args: tuple, kwargs: dict) -> Any:
    """Prepare input for span attributes."""
    if not args and not kwargs:
        return None
    if len(args) == 1 and not kwargs:
        return _serialize_for_span(args[0])
    # Multiple args or kwargs - combine into dict
    result = {}
    if args:
        result["args"] = [_serialize_for_span(arg) for arg in args]
    if kwargs:
        result["kwargs"] = {k: _serialize_for_span(v) for k, v in kwargs.items()}
    return result


def _prepare_and_filter_input(
    args: tuple,
    kwargs: dict,
    filter_input: Optional[Callable[[Any], Any]],
    ignore_input: Optional[Any],
) -> Any:
    """Prepare and filter input for span attributes."""
    input_data = _prepare_input(args, kwargs)
    if filter_input:
        input_data = filter_input(input_data)
    if ignore_input and isinstance(input_data, dict):
        for key in ignore_input:
            if key in input_data:
                del input_data[key]
    return input_data


def _prepare_and_filter_output(
    result: Any,
    filter_output: Optional[Callable[[Any], Any]],
    ignore_output: Optional[Any],
) -> Any:
    """Prepare and filter output for span attributes."""
    output_data = result
    if filter_output:
        output_data = filter_output(output_data)
    if ignore_output and isinstance(output_data, dict):
        output_data = output_data.copy()
        for key in ignore_output:
            if key in output_data:
                del output_data[key]
    return output_data


def _handle_span_exception(span: trace.Span, exception: Exception) -> None:
    """Record exception on span and set error status."""
    error = exception if isinstance(exception, Exception) else Exception(str(exception))
    span.record_exception(error)
    span.set_status(Status(StatusCode.ERROR, str(error)))


class TracedGenerator:
    """Wrapper for sync generators that traces iteration."""
    
    def __init__(
        self,
        generator: Any,
        span: trace.Span,
        fn_name: str,
        filter_output: Optional[Callable[[Any], Any]],
        ignore_output: Optional[Any],
        context_token: Any,
    ):
        self._generator = generator
        self._span = span
        self._fn_name = fn_name
        self._filter_output = filter_output
        self._ignore_output = ignore_output
        self._context_token = context_token
        self._yielded_values = []
        self._exhausted = False
    
    def __iter__(self):
        return self
    
    def __next__(self):
        if self._exhausted:
            raise StopIteration
        
        try:
            value = next(self._generator)
            self._yielded_values.append(value)
            return value
        except StopIteration:
            self._exhausted = True
            self._finalize_span_success()
            trace.context_api.detach(self._context_token)
            self._span.end()
            raise
        except Exception as exception:
            self._exhausted = True
            _handle_span_exception(self._span, exception)
            trace.context_api.detach(self._context_token)
            self._span.end()
            raise
    
    def _finalize_span_success(self):
        """Set output and success status on span."""
        # Record summary of yielded values
        output_data = {
            "type": "generator",
            "yielded_count": len(self._yielded_values),
        }
        
        # Optionally include sample values (limit to avoid huge spans)
        if self._yielded_values:
            sample_size = min(10, len(self._yielded_values))
            output_data["sample_values"] = [
                _serialize_for_span(v) for v in self._yielded_values[:sample_size]
            ]
            if len(self._yielded_values) > sample_size:
                output_data["truncated"] = True
        
        output_data = _prepare_and_filter_output(output_data, self._filter_output, self._ignore_output)
        self._span.set_attribute("output", _serialize_for_span(output_data))
        self._span.set_status(Status(StatusCode.OK))


class TracedAsyncGenerator:
    """Wrapper for async generators that traces iteration."""
    
    def __init__(
        self,
        generator: Any,
        span: trace.Span,
        fn_name: str,
        filter_output: Optional[Callable[[Any], Any]],
        ignore_output: Optional[Any],
        context_token: Any,
    ):
        self._generator = generator
        self._span = span
        self._fn_name = fn_name
        self._filter_output = filter_output
        self._ignore_output = ignore_output
        self._context_token = context_token
        self._yielded_values = []
        self._exhausted = False
    
    def __aiter__(self):
        return self
    
    async def __anext__(self):
        if self._exhausted:
            raise StopAsyncIteration
        
        try:
            value = await self._generator.__anext__()
            self._yielded_values.append(value)
            return value
        except StopAsyncIteration:
            self._exhausted = True
            self._finalize_span_success()
            trace.context_api.detach(self._context_token)
            self._span.end()
            raise
        except Exception as exception:
            self._exhausted = True
            _handle_span_exception(self._span, exception)
            trace.context_api.detach(self._context_token)
            self._span.end()
            raise
    
    def _finalize_span_success(self):
        """Set output and success status on span."""
        # Record summary of yielded values
        output_data = {
            "type": "async_generator",
            "yielded_count": len(self._yielded_values),
        }
        
        # Optionally include sample values (limit to avoid huge spans)
        if self._yielded_values:
            sample_size = min(10, len(self._yielded_values))
            output_data["sample_values"] = [
                _serialize_for_span(v) for v in self._yielded_values[:sample_size]
            ]
            if len(self._yielded_values) > sample_size:
                output_data["truncated"] = True
        
        output_data = _prepare_and_filter_output(output_data, self._filter_output, self._ignore_output)
        self._span.set_attribute("output", _serialize_for_span(output_data))
        self._span.set_status(Status(StatusCode.OK))


def WithTracing(
    func: Optional[Callable] = None,
    *,
    name: Optional[str] = None,
    ignore_input: Optional[Any] = None,
    ignore_output: Optional[Any] = None,
    filter_input: Optional[Callable[[Any], Any]] = None,
    filter_output: Optional[Callable[[Any], Any]] = None,
):
    """
    Decorator to automatically create spans for function calls.
    Records input/output as span attributes. Spans are automatically linked via OpenTelemetry context.
    
    Works with synchronous functions, asynchronous functions, generator functions, and async generator functions.
    
    Args:
        func: The function to trace (when used as @WithTracing)
        name: Optional custom name for the span (defaults to function name)
        ignore_input: Fields to ignore in input (not yet implemented)
        ignore_output: Fields to ignore in output (not yet implemented)
        filter_input: Function to filter/transform input before recording
        filter_output: Function to filter/transform output before recording
    
    Example:
        @WithTracing
        def my_function(x, y):
            return x + y
        
        @WithTracing
        async def my_async_function(x, y):
            return x + y
        
        @WithTracing
        def my_generator(n):
            for i in range(n):
                yield i * 2
        
        @WithTracing
        async def my_async_generator(n):
            for i in range(n):
                yield i * 2
        
        @WithTracing(name="custom_name")
        def another_function():
            pass
    """
    def decorator(fn: Callable) -> Callable:
        fn_name = name or fn.__name__ or "_"
        
        # Check if already traced
        if hasattr(fn, "_is_traced"):
            logger.warning(f"Function {fn_name} is already traced, skipping tracing again")
            return fn
        
        is_async = inspect.iscoroutinefunction(fn)
        is_generator = inspect.isgeneratorfunction(fn)
        is_async_generator = inspect.isasyncgenfunction(fn) if hasattr(inspect, 'isasyncgenfunction') else False
        
        tracer = trace.get_tracer(AIQA_TRACER_NAME)
        
        def _setup_span(span: trace.Span, input_data: Any) -> bool:
            """Setup span with input data. Returns True if span is recording."""
            if not span.is_recording():
                logger.warning(f"Span {fn_name} is not recording - will not be exported")
                return False
            
            logger.debug(f"Span {fn_name} is recording, trace_id={format(span.get_span_context().trace_id, '032x')}")
            
            if input_data is not None:
                span.set_attribute("input", _serialize_for_span(input_data))
            
            trace_id = format(span.get_span_context().trace_id, "032x")
            logger.debug(f"do traceable stuff {fn_name} {trace_id}")
            return True
        
        def _finalize_span_success(span: trace.Span, result: Any) -> None:
            """Set output and success status on span."""
            output_data = _prepare_and_filter_output(result, filter_output, ignore_output)
            span.set_attribute("output", _serialize_for_span(output_data))
            span.set_status(Status(StatusCode.OK))
        
        def _execute_with_span_sync(executor: Callable[[], Any], input_data: Any) -> Any:
            """Execute sync function within span context, handling input/output and exceptions."""
            with tracer.start_as_current_span(fn_name) as span:
                if not _setup_span(span, input_data):
                    return executor()
                
                try:
                    result = executor()
                    _finalize_span_success(span, result)
                    return result
                except Exception as exception:
                    _handle_span_exception(span, exception)
                    raise
        
        async def _execute_with_span_async(executor: Callable[[], Any], input_data: Any) -> Any:
            """Execute async function within span context, handling input/output and exceptions."""
            with tracer.start_as_current_span(fn_name) as span:
                if not _setup_span(span, input_data):
                    return await executor()
                
                try:
                    result = await executor()
                    _finalize_span_success(span, result)
                    logger.debug(f"Span {fn_name} completed successfully, is_recording={span.is_recording()}")
                    return result
                except Exception as exception:
                    _handle_span_exception(span, exception)
                    raise
                finally:
                    logger.debug(f"Span {fn_name} context exiting, is_recording={span.is_recording()}")
        
        def _execute_generator_sync(executor: Callable[[], Any], input_data: Any) -> Any:
            """Execute sync generator function, returning a traced generator."""
            # Create span but don't use 'with' - span will be closed by TracedGenerator
            span = tracer.start_span(fn_name)
            token = trace.context_api.attach(trace.context_api.set_span_in_context(span))
            
            try:
                if not _setup_span(span, input_data):
                    generator = executor()
                    trace.context_api.detach(token)
                    span.end()
                    return generator
                
                generator = executor()
                return TracedGenerator(generator, span, fn_name, filter_output, ignore_output, token)
            except Exception as exception:
                trace.context_api.detach(token)
                _handle_span_exception(span, exception)
                span.end()
                raise
        
        async def _execute_generator_async(executor: Callable[[], Any], input_data: Any) -> Any:
            """Execute async generator function, returning a traced async generator."""
            # Create span but don't use 'with' - span will be closed by TracedAsyncGenerator
            span = tracer.start_span(fn_name)
            token = trace.context_api.attach(trace.context_api.set_span_in_context(span))
            
            try:
                if not _setup_span(span, input_data):
                    generator = await executor()
                    trace.context_api.detach(token)
                    span.end()
                    return generator
                
                generator = await executor()
                return TracedAsyncGenerator(generator, span, fn_name, filter_output, ignore_output, token)
            except Exception as exception:
                trace.context_api.detach(token)
                _handle_span_exception(span, exception)
                span.end()
                raise
        
        if is_async_generator:
            @wraps(fn)
            async def async_gen_traced_fn(*args, **kwargs):
                input_data = _prepare_and_filter_input(args, kwargs, filter_input, ignore_input)
                return await _execute_generator_async(
                    lambda: fn(*args, **kwargs),
                    input_data
                )
            
            async_gen_traced_fn._is_traced = True
            logger.debug(f"Function {fn_name} is now traced (async generator)")
            return async_gen_traced_fn
        elif is_generator:
            @wraps(fn)
            def gen_traced_fn(*args, **kwargs):
                input_data = _prepare_and_filter_input(args, kwargs, filter_input, ignore_input)
                return _execute_generator_sync(
                    lambda: fn(*args, **kwargs),
                    input_data
                )
            
            gen_traced_fn._is_traced = True
            logger.debug(f"Function {fn_name} is now traced (generator)")
            return gen_traced_fn
        elif is_async:
            @wraps(fn)
            async def async_traced_fn(*args, **kwargs):
                input_data = _prepare_and_filter_input(args, kwargs, filter_input, ignore_input)
                return await _execute_with_span_async(
                    lambda: fn(*args, **kwargs),
                    input_data
                )
            
            async_traced_fn._is_traced = True
            logger.debug(f"Function {fn_name} is now traced (async)")
            return async_traced_fn
        else:
            @wraps(fn)
            def sync_traced_fn(*args, **kwargs):
                input_data = _prepare_and_filter_input(args, kwargs, filter_input, ignore_input)
                return _execute_with_span_sync(
                    lambda: fn(*args, **kwargs),
                    input_data
                )
            
            sync_traced_fn._is_traced = True
            logger.debug(f"Function {fn_name} is now traced (sync)")
            return sync_traced_fn
    
    # Support both @WithTracing and @WithTracing(...) syntax
    if func is None:
        return decorator
    else:
        return decorator(func)


def set_span_attribute(attribute_name: str, attribute_value: Any) -> bool:
    """
    Set an attribute on the active span.
    
    Returns:
        True if attribute was set, False if no active span found
    """
    span = trace.get_current_span()
    if span and span.is_recording():
        span.set_attribute(attribute_name, _serialize_for_span(attribute_value))
        return True
    return False

def set_span_name(span_name: str) -> bool:
    """
    Set the name of the active span.
    """
    span = trace.get_current_span()
    if span and span.is_recording():
        span.update_name(span_name)
        return True
    return False

def get_active_span() -> Optional[trace.Span]:
    """Get the currently active span."""
    return trace.get_current_span()

def get_provider() -> Optional[TracerProvider]:
    """Get the tracer provider for advanced usage."""
    client = get_client()
    return client.get("provider")

def get_exporter() -> Optional[AIQASpanExporter]:
    """Get the exporter for advanced usage."""
    client = get_client()
    return client.get("exporter")

