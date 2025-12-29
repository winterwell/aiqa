import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, ListGroup, ListGroupItem, Alert, Button, Input, Modal, ModalHeader, ModalBody, ModalFooter, Label, FormGroup } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listApiKeys, createApiKey, updateApiKey, deleteApiKey, API_BASE_URL } from '../api';
import { useToast } from '../utils/toast';
import CopyButton from '../components/generic/CopyButton';

// Generate a secure random API key
function generateApiKey(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash an API key using SHA256.
 */
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
  const [isCreating, setIsCreating] = useState(false);
  const [newlyGeneratedKey, setNewlyGeneratedKey] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const isCreatingRef = useRef(false); // Synchronous flag to prevent race conditions

  const { data: apiKeys, isLoading, error } = useQuery({
    queryKey: ['apiKeys', organisationId],
    queryFn: () => listApiKeys(organisationId!),
    enabled: !!organisationId,
  });

  const handleCreateApiKey = useCallback(async (key: string, name?: string) => {
    // Check ref first (synchronous) - this prevents race conditions
    if (isCreatingRef.current) return;
    isCreatingRef.current = true; // Set immediately (synchronous)
    setIsCreating(true);
    
    // Show the generated key to the user
    setNewlyGeneratedKey(key);
    
    try {
      // Hash the key before sending to backend
      const keyHash = await hashApiKey(key);
      await createApiKey({
        organisation: organisationId!,
        name: name || undefined,
        key_hash: keyHash,
        role: 'developer',
      });
      queryClient.invalidateQueries({ queryKey: ['apiKeys', organisationId] });
      setShowCreateModal(false);
      setNewKeyName('');
    } finally {
      setIsCreating(false);
      isCreatingRef.current = false; // Reset ref when done
    }
  }, [organisationId, queryClient]);

  const handleCreateNewKey = useCallback(() => {
    const newKey = generateApiKey();
    handleCreateApiKey(newKey, newKeyName.trim() || undefined);
  }, [newKeyName, handleCreateApiKey]);

  const updateApiKeyMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: { role?: 'trace' | 'developer' | 'admin' } }) => updateApiKey(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys', organisationId] });
    },
  });

  const deleteApiKeyMutation = useMutation({
    mutationFn: (id: string) => deleteApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys', organisationId] });
    },
  });

  const handleDelete = (apiKeyId: string) => {
    if (window.confirm('Are you sure you want to delete this API key? This action cannot be undone.')) {
      deleteApiKeyMutation.mutate(apiKeyId);
    }
  };

  // Reset ref when organisation changes
  useEffect(() => {
    isCreatingRef.current = false;
  }, [organisationId]);

  // Auto-create API key if none exist
  useEffect(() => {
    if (!isLoading && apiKeys && Array.isArray(apiKeys) && apiKeys.length === 0 && !isCreatingRef.current) {
      const newKey = generateApiKey();
      handleCreateApiKey(newKey, undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, apiKeys]);

  if (isLoading || isCreating) {
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
            <div className="text-center">
              {isCreating ? (
                <Alert color="info">
                  <div className="spinner-border spinner-border-sm me-2" role="status">
                    <span className="visually-hidden">Loading...</span>
                  </div>
                  Creating an API key for you...
                </Alert>
              ) : (
                <div className="spinner-border" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
              )}
            </div>
          </Col>
        </Row>
      </Container>
    );
  }

  if (error) {
    return (
      <Container className="mt-4">
        <div className="alert alert-danger">
          <h4>Error</h4>
          <p>Failed to load API keys: {error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
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
                disabled={isCreating}
              >
                Create New API Key
              </Button>
            </CardHeader>
            <CardBody>
              {newlyGeneratedKey && (
                <Alert color="success" className="mb-3">
                  <h5>Your new API key (save this now - you won't be able to see it again!):</h5>
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <pre className="bg-light p-3 rounded flex-grow-1" style={{ fontSize: '0.9em', wordBreak: 'break-all', margin: 0 }}>
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
                  Creating an API key for you...
                </Alert>
              ) : (
                <ListGroup flush>
                  {keys.map((apiKey: any) => (
                    <ListGroupItem key={apiKey.id}>
                      <div className="d-flex justify-content-between align-items-start">
                        <div className="flex-grow-1">
                          <div>
                            <strong>{apiKey.name || 'API Key'}:</strong> {apiKey.id}
                          </div>
                          {apiKey.rate_limit_per_hour && (
                            <div>
                              <strong>Rate Limit:</strong> {apiKey.rate_limit_per_hour} per hour
                            </div>
                          )}
                          {apiKey.retention_period_days && (
                            <div>
                              <strong>Retention Period:</strong> {apiKey.retention_period_days} days
                            </div>
                          )}
                          <div className="mt-3">
                            <FormGroup>
                              <Label for={`role-${apiKey.id}`}>Role:</Label>
                              <Input
                                type="select"
                                id={`role-${apiKey.id}`}
                                value={apiKey.role || 'developer'}
                                onChange={(e) => {
                                  updateApiKeyMutation.mutate({
                                    id: apiKey.id,
                                    updates: { role: e.target.value as 'trace' | 'developer' | 'admin' }
                                  });
                                }}
                                disabled={updateApiKeyMutation.isPending}
                                style={{ maxWidth: '200px' }}
                              >
                                <option value="trace">Trace (can only post spans)</option>
                                <option value="developer">Developer (most endpoints)</option>
                                <option value="admin">Admin (all endpoints)</option>
                              </Input>
                            </FormGroup>
                          </div>
                          <div className="text-muted small mt-2">
                            Created: {new Date(apiKey.created).toLocaleString()}
                          </div>
                        </div>
                        <Button
                          color="danger"
                          size="sm"
                          onClick={() => handleDelete(apiKey.id)}
                          disabled={deleteApiKeyMutation.isPending}
                        >
                          {deleteApiKeyMutation.isPending ? 'Deleting...' : 'Delete'}
                        </Button>
                      </div>
                    </ListGroupItem>
                  ))}
                </ListGroup>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      {(newlyGeneratedKey || keys.length > 0) && (
        <Row className="mt-4">
          <Col>
            <Card>
              <CardHeader>
                <h5>Test Your API Key</h5>
              </CardHeader>
              <CardBody>
                <p>Use this curl command to test your API key by fetching your datasets:</p>
                <div className="d-flex align-items-start gap-2">
                  <pre className="bg-light p-3 rounded flex-grow-1" style={{ fontSize: '0.9em', margin: 0, overflowX: 'auto' }}>
                    {`curl -X GET "${API_BASE_URL}/dataset?organisation=${organisationId}" \\
  -H "Authorization: ApiKey ${newlyGeneratedKey || 'YOUR_API_KEY'}" \\
  -H "Content-Type: application/json"`}
                  </pre>
                  <Button
                    color="info"
                    size="sm"
                    onClick={async () => {
                      const curlCommand = `curl -X GET "${API_BASE_URL}/dataset?organisation=${organisationId}" \\
  -H "Authorization: ApiKey ${newlyGeneratedKey || 'YOUR_API_KEY'}" \\
  -H "Content-Type: application/json"`;
                      try {
                        await navigator.clipboard.writeText(curlCommand);
                        showToast('Curl command copied to clipboard!', 'success');
                      } catch (err) {
                        console.error('Failed to copy:', err);
                        showToast('Failed to copy curl command', 'error');
                      }
                    }}
                    title="Copy curl command"
                  >
                    Copy
                  </Button>
                </div>
                <p className="text-muted small mt-2">
                  <strong>Note:</strong> Replace <code>YOUR_API_KEY</code> with your actual API key if you've already saved it.
                  {newlyGeneratedKey && ' The command above uses your newly generated key.'}
                </p>
              </CardBody>
            </Card>
          </Col>
        </Row>
      )}

      <Modal isOpen={showCreateModal} toggle={() => setShowCreateModal(false)}>
        <ModalHeader toggle={() => setShowCreateModal(false)}>Create New API Key</ModalHeader>
        <ModalBody>
          <Label for="keyName">Name (optional)</Label>
          <Input
            type="text"
            id="keyName"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="e.g., Production API Key"
          />
          <p className="text-muted small mt-2">
            A name helps you identify this API key later. The key itself will be shown after creation.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button color="secondary" onClick={() => setShowCreateModal(false)}>
            Cancel
          </Button>
          <Button color="primary" onClick={handleCreateNewKey} disabled={isCreating}>
            {isCreating ? 'Creating...' : 'Create API Key'}
          </Button>
        </ModalFooter>
      </Modal>
    </Container>
  );
};

export default ApiKeyPage;

