# A Python client for the AIQA server

OpenTelemetry-based client for tracing Python functions and sending traces to the AIQA server.

## Installation

### From PyPI (recommended)

```bash
pip install aiqa-client
```

### From source

```bash
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
pip install -e .
```

See [TESTING.md](TESTING.md) for detailed testing instructions.

## Setup

Set the following environment variables:

```bash
export AIQA_SERVER_URL="http://localhost:3000"
export AIQA_API_KEY="your-api-key"
```

## Usage

### Basic Usage

```python
from aiqa import WithTracing

@WithTracing
def my_function(x, y):
    return x + y

@WithTracing
async def my_async_function(x, y):
    await asyncio.sleep(0.1)
    return x * y
```

### Custom Span Name

```python
@WithTracing(name="custom_span_name")
def my_function():
    pass
```

### Input/Output Filtering

```python
@WithTracing(
    filter_input=lambda x: {"filtered": str(x)},
    filter_output=lambda x: {"result": x}
)
def my_function(data):
    return {"processed": data}
```

### Flushing Spans

Spans are automatically flushed every 5 seconds. To flush immediately:

```python
from aiqa import flush_tracing
import asyncio

async def main():
    # Your code here
    await flush_tracing()

asyncio.run(main())
```

### Shutting Down

To ensure all spans are sent before process exit:

```python
from aiqa import shutdown_tracing
import asyncio

async def main():
    # Your code here
    await shutdown_tracing()

asyncio.run(main())
```

### Setting Span Attributes and Names

```python
from aiqa import set_span_attribute, set_span_name

def my_function():
    set_span_attribute("custom.attribute", "value")
    set_span_name("custom_span_name")
    # ... rest of function
```

## Features

- Automatic tracing of function calls (sync and async)
- Records function inputs and outputs as span attributes
- Automatic error tracking and exception recording
- Thread-safe span buffering and auto-flushing
- OpenTelemetry context propagation for nested spans

## Example

See `example.py` for a complete working example.