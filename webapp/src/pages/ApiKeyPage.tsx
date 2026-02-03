import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, ListGroup, Alert, Button } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listApiKeys, updateApiKey, deleteApiKey, createApiKey } from '../api';
import { ApiKeyListItem } from '../components/apikey/ApiKeyListItem';
import { ApiKeyHowToUseSection } from '../components/apikey/TestApiKeySection';
import { CreateApiKeyModal } from '../components/apikey/CreateApiKeyModal';
import CopyButton from '../components/generic/CopyButton';
import { useToast } from '../utils/toast';

function generateApiKey(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const ApiKeyPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newlyGeneratedKey, setNewlyGeneratedKey] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const { data: apiKeys, isLoading, error } = useQuery({
    queryKey: ['apiKeys', organisationId],
    queryFn: () => listApiKeys(organisationId!),
    enabled: !!organisationId,
  });

  const createApiKeyMutation = useMutation({
    mutationFn: async ({ key, name }: { key: string; name?: string }) => {
      const hash = await hashApiKey(key);
      const keyEnd = key.slice(-4);
      return createApiKey({
        organisation: organisationId!,
        name: name || undefined,
        hash,
        keyEnd,
        role: 'developer',
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys', organisationId] });
      setShowCreateModal(false);
      setNewKeyName('');
      setCreateError(null);
      setNewlyGeneratedKey(variables.key);
    },
    onError: (error: Error) => {
      const errorMessage = error.message || 'Failed to create API key';
      setCreateError(errorMessage);
      setNewlyGeneratedKey(null);
      showToast(errorMessage, 'error');
    },
  });

  const updateApiKeyMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: { role?: 'trace' | 'developer' | 'admin' } }) =>
      updateApiKey(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys', organisationId] });
      showToast('API key updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to update API key', 'error');
    },
  });

  const deleteApiKeyMutation = useMutation({
    mutationFn: (id: string) => deleteApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys', organisationId] });
      showToast('API key deleted successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to delete API key', 'error');
    },
  });

  const handleCreateNewKey = () => {
    if (!organisationId) return;
    
    setCreateError(null);
    const newKey = generateApiKey();
    
    createApiKeyMutation.mutate({
      key: newKey,
      name: newKeyName.trim() || undefined,
    });
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setNewKeyName('');
    setCreateError(null);
  };

  const handleRoleChange = (id: string, role: 'trace' | 'developer' | 'admin') => {
    updateApiKeyMutation.mutate({ id, updates: { role } });
  };

  const handleDelete = (apiKeyId: string) => {
    if (window.confirm('Are you sure you want to delete this API key? This action cannot be undone.')) {
      deleteApiKeyMutation.mutate(apiKeyId);
    }
  };

  const handleDismissNewKey = () => {
    setNewlyGeneratedKey(null);
  };

  if (isLoading) {
    return (
      <Container>
        <Row>
          <Col>
            <h1>AIQA API Keys</h1>
            <p className="text-muted">Keys to send traces to AIQA and run experiments. Manage API keys for organisation: {organisationId}</p>
          </Col>
        </Row>
        <Row className="mt-4">
          <Col>
            <div className="text-center">
              <div className="spinner-border" role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
            </div>
          </Col>
        </Row>
      </Container>
    );
  }

  if (error) {
    return (
      <Container>
        <Alert color="danger">
          <h4>Error</h4>
          <p>Failed to load API keys: {error instanceof Error ? error.message : 'Unknown error'}</p>
        </Alert>
      </Container>
    );
  }

  const keys = Array.isArray(apiKeys) ? apiKeys : [];

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <h1>API Keys</h1>
          <p className="text-muted">Manage API keys for organisation: {organisationId}</p>
        </Col>
      </Row>

      <Row className="mt-4">
        <Col>
          <Card>
            <CardHeader className="d-flex justify-content-between align-items-center">
              <h5>API Key Management</h5>
              <Button
                color="primary"
                size="sm"
                onClick={() => setShowCreateModal(true)}
                disabled={createApiKeyMutation.isPending}
              >
                Create New API Key
              </Button>
            </CardHeader>
            <CardBody>
              {newlyGeneratedKey && (
                <Alert color="success" className="mb-3">
                  <div className="d-flex justify-content-between align-items-start mb-2">
                    <h5 className="mb-0">Your new API key (save this now - you won't be able to see it again!):</h5>
                    <Button close onClick={handleDismissNewKey} />
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <pre className="bg-light p-3 rounded flex-grow-1" style={{ fontSize: '0.9em', wordBreak: 'break-all', margin: 0, minWidth: 0, maxWidth: '100%', overflowX: 'auto', whiteSpace: 'normal' }}>
                      {newlyGeneratedKey}
                    </pre>
                    <CopyButton
                      content={newlyGeneratedKey}
                      className="btn btn-info btn-sm"
                      showToast={showToast}
                      successMessage="API key copied to clipboard!"
                    />
                  </div>
                </Alert>
              )}
              {keys.length === 0 ? (
                <Alert color="info">
                  No API keys found. Create your first API key to get started.
                </Alert>
              ) : (
                <ListGroup flush>
                  {keys.map((apiKey: any) => (
                    <ApiKeyListItem
                      key={apiKey.id}
                      apiKey={apiKey}
                      onRoleChange={handleRoleChange}
                      onDelete={handleDelete}
                      isUpdating={updateApiKeyMutation.isPending}
                      isDeleting={deleteApiKeyMutation.isPending}
                    />
                  ))}
                </ListGroup>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      {(newlyGeneratedKey || keys.length > 0) && (
        <ApiKeyHowToUseSection organisationId={organisationId} newlyGeneratedKey={newlyGeneratedKey} />
      )}

      <CreateApiKeyModal
        isOpen={showCreateModal}
        toggle={closeModal}
        newKeyName={newKeyName}
        onKeyNameChange={setNewKeyName}
        onCreate={handleCreateNewKey}
        isCreating={createApiKeyMutation.isPending}
        createError={createError}
      />
    </Container>
  );
};

export default ApiKeyPage;

