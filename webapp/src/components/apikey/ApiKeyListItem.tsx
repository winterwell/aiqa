import React from 'react';
import { ListGroupItem, Button, Input, Label, FormGroup } from 'reactstrap';

interface ApiKeyListItemProps {
  apiKey: {
    id: string;
    name?: string;
    key_end?: string;
    role?: 'trace' | 'developer' | 'admin';
    rate_limit_per_hour?: number;
    retention_period_days?: number;
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
          {apiKey.key_end && (
            <div className="text-muted small mt-2">Key ending: **** {apiKey.key_end}</div>
          )}
          <div className="text-muted small mt-2">ID: {apiKey.id}</div>
       
          <div className="text-muted small mt-2">Created: {new Date(apiKey.created).toLocaleString()}</div>
       
          {apiKey.rate_limit_per_hour && (
            <div><strong>Rate Limit:</strong> {apiKey.rate_limit_per_hour} per hour</div>
          )}
          {apiKey.retention_period_days && (
            <div><strong>Retention Period:</strong> {apiKey.retention_period_days} days</div>
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

