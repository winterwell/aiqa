import { useState, useEffect, useCallback, useRef } from 'react';
import { getSpanId } from '../common/types';
import { getSpanName } from '../utils/span-utils';
import { Span } from '../common/types';

interface SpanTree {
  span: Span;
  children: SpanTree[];
}

/**
 * Hook for managing span tree state: selection, expansion, and filtering.
 */
export function useSpanTreeState(spanTree: SpanTree | null) {
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [expandedSpanIds, setExpandedSpanIds] = useState<Set<string>>(new Set());
  const [filterInput, setFilterInput] = useState('');
  const [debouncedFilter, setDebouncedFilter] = useState('');
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce filter input (500ms delay)
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedFilter(filterInput);
    }, 500);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [filterInput]);

  // Track the previous root span ID to detect when tree changes
  const prevRootSpanIdRef = useRef<string | null>(null);
  
  // Always expand root span when tree loads or changes
  useEffect(() => {
    if (spanTree) {
      const rootSpanId = getSpanId(spanTree.span);
      const rootChanged = prevRootSpanIdRef.current !== rootSpanId;
      
      if (rootChanged) {
        setExpandedSpanIds(new Set([rootSpanId]));
        prevRootSpanIdRef.current = rootSpanId;
      }
    } else {
      prevRootSpanIdRef.current = null;
    }
  }, [spanTree]);
  
  // Initialize selected span to the root span when tree is loaded (only if nothing selected)
  useEffect(() => {
    if (spanTree && !selectedSpanId) {
      const rootSpanId = getSpanId(spanTree.span);
      setSelectedSpanId(rootSpanId);
    }
  }, [spanTree, selectedSpanId]);

  // Auto-expand nodes that contain matching spans when filter is applied
  useEffect(() => {
    if (!debouncedFilter || !spanTree) return;

    const filterLower = debouncedFilter.toLowerCase().trim();
    if (!filterLower) return;

    const spansToExpand = new Set<string>();

    // Recursively find matching nodes and expand all nodes on path to matches
    function findMatchesAndExpandPath(tree: SpanTree, pathFromRoot: string[]): boolean {
      const spanId = getSpanId(tree.span);
      const currentPath = [...pathFromRoot, spanId];

      const spanName = getSpanName(tree.span).toLowerCase();
      const matches = spanName.includes(filterLower);

      // Check if any descendant matches
      let hasMatchingDescendant = false;
      for (const child of tree.children) {
        if (findMatchesAndExpandPath(child, currentPath)) {
          hasMatchingDescendant = true;
        }
      }

      // If this node matches or has a matching descendant, expand the entire path from root
      if (matches || hasMatchingDescendant) {
        // Expand all nodes in the path from root to this node (including this node)
        currentPath.forEach(id => spansToExpand.add(id));
      }

      return matches || hasMatchingDescendant;
    }

    findMatchesAndExpandPath(spanTree, []);

    setExpandedSpanIds(prev => {
      const next = new Set(prev);
      spansToExpand.forEach(id => next.add(id));
      return next;
    });
  }, [debouncedFilter, spanTree]);

  const toggleExpanded = useCallback((spanId: string) => {
    setExpandedSpanIds(prev => {
      const next = new Set(prev);
      next.has(spanId) ? next.delete(spanId) : next.add(spanId);
      return next;
    });
  }, []);

  const handleSelectSpan = useCallback((spanId: string) => {
    setSelectedSpanId(spanId);
  }, []);

  return {
    selectedSpanId,
    expandedSpanIds,
    filterInput,
    debouncedFilter,
    setFilterInput,
    toggleExpanded,
    handleSelectSpan,
  };
}

