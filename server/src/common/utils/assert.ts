export function assert(condition: any, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

export function assMatch(value: any, type: any, message?: string): void {
  if (type === String) {
    if (typeof value !== 'string') {
      throw new Error(message || `Expected string, got ${typeof value}`);
    }
  } else if (type === Number) {
    if (typeof value !== 'number') {
      throw new Error(message || `Expected number, got ${typeof value}`);
    }
  } else if (type === Boolean) {
    if (typeof value !== 'boolean') {
      throw new Error(message || `Expected boolean, got ${typeof value}`);
    }
  } else if (type === '?String') {
    if (value !== null && value !== undefined && typeof value !== 'string') {
      throw new Error(message || `Expected string or null/undefined, got ${typeof value}`);
    }
  } else if (type === 'String[]') {
    if (!Array.isArray(value)) {
      throw new Error(message || `Expected array, got ${typeof value}`);
    }
    for (const item of value) {
      if (typeof item !== 'string') {
        throw new Error(message || `Expected array of strings, got ${typeof item}`);
      }
    }
  } else if (typeof type === 'function') {
    if (!(value instanceof type)) {
      throw new Error(message || `Expected instance of ${type.name}, got ${typeof value}`);
    }
  }
}

