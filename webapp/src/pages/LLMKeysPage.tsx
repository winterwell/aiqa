import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, ListGroup, ListGroupItem, Alert, Button, Input, Label, FormGroup } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listModels, deleteModel, createModel } from '../api';
import { useToast } from '../utils/toast';
import Model from '../common/types/Model';

const LLMKeysPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newModelProvider, setNewModelProvider] = useState<'openai' | 'anthropic' | 'google' | 'azure' | 'bedrock' | 'other'>('openai');
  const [newModelName, setNewModelName] = useState('');
  const [newModelApiKey, setNewModelApiKey] = useState('');
  const [newModelVersion, setNewModelVersion] = useState('');
  const [newModelDescription, setNewModelDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const { data: models, isLoading, error } = useQuery({
    queryKey: ['models', organisationId],
    queryFn: () => listModels(organisationId!),
    enabled: !!organisationId,
  });

  const createModelMutation = useMutation({
    mutationFn: async (model: {
      provider: 'openai' | 'anthropic' | 'google' | 'azure' | 'bedrock' | 'other';
      name: string;
      key: string;
      version?: string;
      description?: string;
    }) => {
      return createModel(organisationId!, model);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models', organisationId] });
      setShowCreateModal(false);
      setNewModelProvider('openai');
      setNewModelName('');
      setNewModelApiKey('');
      setNewModelVersion('');
      setNewModelDescription('');
      setCreateError(null);
      showToast('LLM key created successfully', 'success');
    },
    onError: (error: Error) => {
      const errorMessage = error.message || 'Failed to create LLM key';
      setCreateError(errorMessage);
      showToast(errorMessage, 'error');
    },
  });

  const deleteModelMutation = useMutation({
    mutationFn: (id: string) => deleteModel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models', organisationId] });
      showToast('LLM key deleted successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to delete LLM key', 'error');
    },
  });

  const handleCreateNewModel = () => {
    if (!organisationId) return;
    
    if (!newModelName.trim()) {
      setCreateError('Model name is required');
      return;
    }
    
    if (!newModelApiKey.trim()) {
      setCreateError('API key is required');
      return;
    }
    
    setCreateError(null);
    
    createModelMutation.mutate({
      provider: newModelProvider,
      name: newModelName.trim(),
      key: newModelApiKey.trim(),
      version: newModelVersion.trim() || undefined,
      description: newModelDescription.trim() || undefined,
    });
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setNewModelProvider('openai');
    setNewModelName('');
    setNewModelApiKey('');
    setNewModelVersion('');
    setNewModelDescription('');
    setCreateError(null);
  };

  const handleDelete = (modelId: string) => {
    if (window.confirm('Are you sure you want to delete this LLM key? This action cannot be undone.')) {
      deleteModelMutation.mutate(modelId);
    }
  };

  if (isLoading) {
    return (
      <Container>
        <Row>
          <Col>
            <h1>LLM Keys</h1>
            <p className="text-muted">Manage LLM API keys for organisation: {organisationId}</p>
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
          <p>Failed to load LLM keys: {error instanceof Error ? error.message : 'Unknown error'}</p>
        </Alert>
      </Container>
    );
  }

  const modelList = Array.isArray(models) ? models : [];

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <h1>LLM Keys</h1>
          <p className="text-muted">Keys to enable AI server-side features, like server-side LLM-as-Judge. 
            These are not essential for core tracing or if you run your own LLM-as-Judge on your own machine.</p>
        </Col>
      </Row>

      <Row className="mt-4">
        <Col>
          <Card>
            <CardHeader className="d-flex justify-content-between align-items-center">
              <h5>LLM Key Management</h5>
              <Button
                color="primary"
                size="sm"
                onClick={() => setShowCreateModal(true)}
                disabled={createModelMutation.isPending}
              >
                Add LLM Key
              </Button>
            </CardHeader>
            <CardBody>
              {modelList.length === 0 ? (
                <Alert color="info">
                  No LLM keys found. Add your first LLM key to get started.
                </Alert>
              ) : (
                <ListGroup flush>
                  {modelList.map((model: Model) => (
                    <ListGroupItem key={model.id}>
                      <div className="d-flex justify-content-between align-items-start">
                        <div className="flex-grow-1">
                          <div><strong>{model.name}</strong></div>
                          <div className="text-muted small mt-2">
                            Provider: {model.provider}
                            {model.version && ` • Version: ${model.version}`}
                          </div>
                          {model.keyEnd && (
                            <div className="text-muted small mt-2">API Key: {model.keyEnd}</div>
                          )}
                          {model.description && (
                            <div className="text-muted small mt-2">{model.description}</div>
                          )}
                          <div className="text-muted small mt-2">Our ID: {model.id}</div>
                          <div className="text-muted small mt-2">Created: {new Date(model.created).toLocaleString()}</div>
                        </div>
                        <Button
                          color="danger"
                          size="sm"
                          onClick={() => handleDelete(model.id)}
                          disabled={deleteModelMutation.isPending}
                        >
                          {deleteModelMutation.isPending ? 'Deleting...' : 'Delete'}
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

      {/* Create Model Modal */}
      {showCreateModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={closeModal}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Add LLM Key</h5>
                <button type="button" className="btn-close" onClick={closeModal}></button>
              </div>
              <div className="modal-body">
                {createError && (
                  <Alert color="danger" className="mb-3">
                    {createError}
                  </Alert>
                )}
                <FormGroup>
                  <Label for="provider">Provider</Label>
                  <Input
                    type="select"
                    id="provider"
                    value={newModelProvider}
                    onChange={(e) => setNewModelProvider(e.target.value as any)}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                    <option value="azure">Azure</option>
                    <option value="bedrock">Bedrock</option>
                    <option value="other">Other</option>
                  </Input>
                </FormGroup>
                <FormGroup>
                  <Label for="name">Model Name *</Label>
                  <Input
                    type="text"
                    id="name"
                    value={newModelName}
                    onChange={(e) => setNewModelName(e.target.value)}
                    placeholder="e.g., gpt-4o"
                  />
                </FormGroup>
                <FormGroup>
                  <Label for="apiKey">API Key *</Label>
                  <Input
                    type="password"
                    id="apiKey"
                    value={newModelApiKey}
                    onChange={(e) => setNewModelApiKey(e.target.value)}
                    placeholder="Enter API key"
                  />
                </FormGroup>
                <FormGroup>
                  <Label for="version">Version (optional)</Label>
                  <Input
                    type="text"
                    id="version"
                    value={newModelVersion}
                    onChange={(e) => setNewModelVersion(e.target.value)}
                    placeholder="e.g., 1.0"
                  />
                </FormGroup>
                <FormGroup>
                  <Label for="description">Description (optional)</Label>
                  <Input
                    type="textarea"
                    id="description"
                    value={newModelDescription}
                    onChange={(e) => setNewModelDescription(e.target.value)}
                    placeholder="Optional description"
                    rows={3}
                  />
                </FormGroup>
              </div>
              <div className="modal-footer">
                <Button color="secondary" onClick={closeModal}>
                  Cancel
                </Button>
                <Button color="primary" onClick={handleCreateNewModel} disabled={createModelMutation.isPending}>
                  {createModelMutation.isPending ? 'Creating...' : 'Add LLM Key'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Container>
  );
};

export default LLMKeysPage;

