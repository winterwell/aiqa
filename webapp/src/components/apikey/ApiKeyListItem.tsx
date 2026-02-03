import React from 'react';
import { ListGroupItem, Button, Input, Label, FormGroup } from 'reactstrap';

interface ApiKeyListItemProps {
  apiKey: {
    id: string;
    name?: string;
    keyEnd?: string;
    role?: 'trace' | 'developer' | 'admin';
    rateLimitPerHour?: number;
    retentionPeriodDays?: number;
    created: string;
  };
  onRoleChange: (id: string, role: 'trace' | 'developer' | 'admin') => void;
  onDelete: (id: string) => void;
  isUpdating: boolean;
  isDeleting: boolean;
}

export const ApiKeyListItem: React.FC<ApiKeyListItemProps> = ({
  apiKey,
  onRoleChange,
  onDelete,
  isUpdating,
  isDeleting,
}) => {
  return (
    <ListGroupItem>
      <div className="d-flex justify-content-between align-items-start">
        <div className="flex-grow-1">
          <div><strong>{apiKey.name || "Unnamed API Key"}</strong></div>
          {apiKey.keyEnd && (
            <div className="text-muted small mt-2">Key ending: **** {apiKey.keyEnd}</div>
          )}
          <div className="text-muted small mt-2">ID: {apiKey.id}</div>
       
          <div className="text-muted small mt-2">Created: {new Date(apiKey.created).toLocaleString()}</div>
       
          {apiKey.rateLimitPerHour != null && apiKey.rateLimitPerHour > 0 && (
            <div><strong>Rate Limit:</strong> {apiKey.rateLimitPerHour} per hour</div>
          )}
          {apiKey.retentionPeriodDays != null && apiKey.retentionPeriodDays > 0 && (
            <div><strong>Retention Period:</strong> {apiKey.retentionPeriodDays} days</div>
          )}
          <div className="mt-3">
            <FormGroup>
              <Label for={`role-${apiKey.id}`}>Role:</Label>
              <Input
                type="select"
                id={`role-${apiKey.id}`}
                value={apiKey.role || 'developer'}
                onChange={(e) => {
                  onRoleChange(apiKey.id, e.target.value as 'trace' | 'developer' | 'admin');
                }}
                disabled={isUpdating}
                style={{ maxWidth: '200px' }}
              >
                <option value="trace">Trace (can only post spans)</option>
                <option value="developer">Developer (most endpoints)</option>
                <option value="admin">Admin (all endpoints)</option>
              </Input>
            </FormGroup>
          </div>
        </div>
        <Button
          color="danger"
          size="sm"
          onClick={() => onDelete(apiKey.id)}
          disabled={isDeleting}
        >
          {isDeleting ? 'Deleting...' : 'Delete'}
        </Button>
      </div>
    </ListGroupItem>
  );
};

