import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, ListGroup, ListGroupItem, Alert } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listApiKeys, createApiKey } from '../api';

// Generate a secure random API key
function generateApiKey(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

const ApiKeyPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const queryClient = useQueryClient();

  const { data: apiKeys, isLoading, error } = useQuery({
    queryKey: ['apiKeys', organisationId],
    queryFn: () => listApiKeys(organisationId!),
    enabled: !!organisationId,
  });

  const createApiKeyMutation = useMutation({
    mutationFn: (key: string) => createApiKey({
      organisation_id: organisationId!,
      key,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys', organisationId] });
    },
  });

  // Auto-create API key if none exist
  useEffect(() => {
    if (!isLoading && apiKeys && Array.isArray(apiKeys) && apiKeys.length === 0 && !createApiKeyMutation.isPending) {
      const newKey = generateApiKey();
      createApiKeyMutation.mutate(newKey);
    }
  }, [isLoading, apiKeys, createApiKeyMutation]);

  if (isLoading || createApiKeyMutation.isPending) {
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
              {createApiKeyMutation.isPending ? (
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
            <CardHeader>
              <h5>API Key Management</h5>
            </CardHeader>
            <CardBody>
              {keys.length === 0 ? (
                <Alert color="info">
                  Creating an API key for you...
                </Alert>
              ) : (
                <ListGroup flush>
                  {keys.map((apiKey: any) => (
                    <ListGroupItem key={apiKey.id}>
                      <div>
                        <strong>API Key:</strong> {apiKey.id}
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
                      <div className="text-muted small mt-2">
                        Created: {new Date(apiKey.created).toLocaleString()}
                      </div>
                    </ListGroupItem>
                  ))}
                </ListGroup>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default ApiKeyPage;

