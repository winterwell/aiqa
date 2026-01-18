import React, { useState } from 'react';
import { Badge, Button, Input } from 'reactstrap';
import { PencilSimple } from '@phosphor-icons/react';

interface TagsProps {
  tags: string[] | undefined;
  setTags: (tags: string[]) => void;
  /** small widget with no label, just the tags */
  compact?: boolean;
}

/**
 * Tags component that displays tags with an edit button.
 * Shows tags as a text list, with an edit pencil icon button.
 * The editor is a simple inline input for a comma-separated string.
 */
export default function Tags({ tags, setTags, compact = false }: TagsProps) {
    if (! tags) tags = [];
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const handleEditClick = () => {
    setEditValue(tags.join(', '));
    setIsEditing(true);
  };

  const handleSave = () => {
    const newTags = editValue
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);
    setTags(newTags);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  return (
    <div className="mb-2">
      <div className="d-flex align-items-center gap-2">
        {!compact && <strong>Tags:</strong>}
        {isEditing ? (
          <Input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            placeholder="Comma-separated tags (e.g., tag1, tag2, tag3)"
            autoFocus
            style={{ flex: 1 }}
          />
        ) : (
          <>
            {tags && tags.length > 0 ? (
              <div className="d-flex flex-wrap gap-1 align-items-center">
                {tags.map((tag, idx) => (
                  <Badge key={idx} color="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : (
              !compact ? <span className="text-muted">None</span> : null
            )}
            <Button
              color="link"
              size="sm"
              className="p-0"
              onClick={handleEditClick}
              title="Edit tags"
            >
              <PencilSimple size={16} />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

