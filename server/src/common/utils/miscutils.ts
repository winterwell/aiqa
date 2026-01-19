export function is(value: any): boolean {
  return value !== null && value !== undefined;
}

export function truncate(s: string, maxLength: number): string {
  if (s.length <= maxLength) {
    return s;
  }
  return s.substring(0, maxLength) + "...";
}

export function asArray(value: any): any[] {
  if (Array.isArray(value)) {
    return value;
  }
  if ( ! value) {
    return [];
  }
  if (typeof value === 'object' && Object.keys(value).length === 0) {
    return [];
  }
  return [value];
}