import React, { useState } from 'react';
import { Badge, Button, Input } from 'reactstrap';
import { X } from '@phosphor-icons/react';

export interface BulkTagChipsProps {
  /** Tags to show (e.g. union across selected rows), sorted for stable display */
  tags: string[];
  /** Remove this tag from every selected row (caller applies bulk semantics) */
  onRemoveTag: (tag: string) => void;
  /** Add this tag to every selected row that does not already have it */
  onAddTag: (tag: string) => void;
  disabled?: boolean;
}

/**
 * Tag list for bulk actions: each tag has its own remove control; separate add field + button.
 * Does not replace the full tag set in one shot (unlike the row-level Tags editor).
 */
export default function BulkTagChips({ tags, onRemoveTag, onAddTag, disabled }: BulkTagChipsProps) {
  const [addValue, setAddValue] = useState('');

  const submitAdd = () => {
    const t = addValue.trim();
    if (!t || disabled) return;
    onAddTag(t);
    setAddValue('');
  };

  return (
    <div className="d-flex flex-wrap align-items-center gap-2">
      {tags.map((tag) => (
        <Badge
          key={tag}
          color="secondary"
          className="d-inline-flex align-items-center gap-1 ps-2 pe-1 py-1"
          style={{ fontWeight: 'normal' }}
        >
          <span>{tag}</span>
          <button
            type="button"
            className="btn btn-link p-0 lh-1 text-white text-opacity-75"
            style={{ lineHeight: 1 }}
            disabled={disabled}
            aria-label={`Remove tag ${tag}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!disabled) onRemoveTag(tag);
            }}
          >
            <X size={14} weight="bold" aria-hidden />
          </button>
        </Badge>
      ))}
      <div className="d-flex align-items-center gap-1">
        <Input
          type="text"
          bsSize="sm"
          placeholder="New tag"
          value={addValue}
          disabled={disabled}
          onChange={(e) => setAddValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submitAdd();
            }
          }}
          style={{ width: '9rem' }}
        />
        <Button
          color="primary"
          outline
          size="sm"
          disabled={disabled || !addValue.trim()}
          onClick={submitAdd}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
