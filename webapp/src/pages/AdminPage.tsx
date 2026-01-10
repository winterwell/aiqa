import React, { useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Container,
  Row,
  Col,
  Card,
  CardBody,
  CardHeader,
  Form,
  FormGroup,
  Button,
  Alert,
  Badge,
} from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getOrganisation, updateOrganisation } from '../api';
import { useToast } from '../utils/toast';
import PropInput from '../components/generic/PropInput';
import { useRerender } from 'rerenderer';

const AdminPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { rerender } = useRerender();

  const formDataRef = useRef<{
    subscriptionType: string;
    rateLimit: string;
    retentionPeriod: string;
    maxMembers: string;
    maxDatasets: string;
    experimentRetentionDays: string;
    maxExamplesPerDataset: string;
  }>({
    subscriptionType: '',
    rateLimit: '',
    retentionPeriod: '',
    maxMembers: '',
    maxDatasets: '',
    experimentRetentionDays: '',
    maxExamplesPerDataset: '',
  });

  const { data: organisation, isLoading, error } = useQuery({
    queryKey: ['organisation', organisationId],
    queryFn: () => getOrganisation(organisationId!),
    enabled: !!organisationId,
  });

  useEffect(() => {
    if (organisation) {
      formDataRef.current = {
        subscriptionType: organisation.subscription?.type || '',
        rateLimit: organisation.rate_limit_per_hour?.toString() || '',
        retentionPeriod: organisation.retention_period_days?.toString() || '',
        maxMembers: organisation.max_members?.toString() || '',
        maxDatasets: organisation.max_datasets?.toString() || '',
        experimentRetentionDays: organisation.experiment_retention_days?.toString() || '',
        maxExamplesPerDataset: organisation.max_examples_per_dataset?.toString() || '',
      };
      rerender();
    }
  }, [organisation, rerender]);

  const updateMutation = useMutation({
    mutationFn: (updates: Parameters<typeof updateOrganisation>[1]) =>
      updateOrganisation(organisationId!, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organisation', organisationId] });
      showToast('Organisation updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(`Failed to update organisation: ${error.message}`, 'error');
    },
  });

  const handleUpdateSubscription = () => {
    const subscriptionType = formDataRef.current.subscriptionType;
    if (!subscriptionType) {
      showToast('Please select a subscription type', 'error');
      return;
    }

    const subscriptionUpdate: any = {
      ...organisation?.subscription,
      type: subscriptionType as 'free' | 'trial' | 'pro' | 'enterprise',
    };

    updateMutation.mutate({ subscription: subscriptionUpdate });
  };

  const handleUpdateRateLimit = () => {
    const value = formDataRef.current.rateLimit.trim();
    if (!value) {
      showToast('Please enter a rate limit', 'error');
      return;
    }

    const numValue = parseInt(value, 10);
    if (isNaN(numValue) || numValue < 0) {
      showToast('Rate limit must be a positive number', 'error');
      return;
    }

    updateMutation.mutate({ rate_limit_per_hour: numValue });
  };

  const handleUpdateRetentionPeriod = () => {
    const value = formDataRef.current.retentionPeriod.trim();
    if (!value) {
      showToast('Please enter a retention period', 'error');
      return;
    }

    const numValue = parseInt(value, 10);
    if (isNaN(numValue) || numValue < 0) {
      showToast('Retention period must be a positive number', 'error');
      return;
    }

    updateMutation.mutate({ retention_period_days: numValue });
  };

  const handleUpdateAllThresholds = () => {
    const updates: any = {};
    const formData = formDataRef.current;

    if (formData.maxMembers.trim()) {
      const value = parseInt(formData.maxMembers, 10);
      if (!isNaN(value) && value >= 0) updates.max_members = value;
    }

    if (formData.maxDatasets.trim()) {
      const value = parseInt(formData.maxDatasets, 10);
      if (!isNaN(value) && value >= 0) updates.max_datasets = value;
    }

    if (formData.experimentRetentionDays.trim()) {
      const value = parseInt(formData.experimentRetentionDays, 10);
      if (!isNaN(value) && value >= 0) updates.experiment_retention_days = value;
    }

    if (formData.maxExamplesPerDataset.trim()) {
      const value = parseInt(formData.maxExamplesPerDataset, 10);
      if (!isNaN(value) && value >= 0) updates.max_examples_per_dataset = value;
    }

    if (Object.keys(updates).length === 0) {
      showToast('Please enter at least one threshold value', 'error');
      return;
    }

    updateMutation.mutate(updates);
  };

  const formData = formDataRef.current;

  if (isLoading) {
    return (
      <Container>
        <div className="text-center">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      </Container>
    );
  }

  if (error || !organisation) {
    return (
      <Container>
        <Alert color="danger">
          <h4>Error</h4>
          <p>Failed to load organisation: {error instanceof Error ? error.message : 'Unknown error'}</p>
        </Alert>
      </Container>
    );
  }

  const currentSubscriptionType = organisation.subscription?.type || 'Not set';
  const currentRateLimit = organisation.rate_limit_per_hour ?? 'Not set';
  const currentRetentionPeriod = organisation.retention_period_days ?? 'Not set';

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <h1>Admin Settings</h1>
          <p className="text-muted">Manage subscription and thresholds for {organisation.name}</p>
        </Col>
      </Row>

      <Row className="mt-4">
        <Col md={6}>
          <Card className="mb-4">
            <CardHeader>
              <h5>Subscription</h5>
            </CardHeader>
            <CardBody>
              <div className="mb-3">
                <strong>Current Subscription:</strong>{' '}
                <Badge color="info">{currentSubscriptionType}</Badge>
              </div>
              <Form>
                <FormGroup>
                  <PropInput
                    label="Subscription Type"
                    item={formData}
                    prop="subscriptionType"
                    type="select"
                    options={['free', 'trial', 'pro', 'enterprise']}
                    onChange={rerender}
                  />
                </FormGroup>
                <Button
                  color="primary"
                  onClick={handleUpdateSubscription}
                  disabled={updateMutation.isPending || !formData.subscriptionType}
                >
                  {updateMutation.isPending ? 'Updating...' : 'Update Subscription'}
                </Button>
              </Form>
            </CardBody>
          </Card>

          <Card className="mb-4">
            <CardHeader>
              <h5>Rate Limit</h5>
            </CardHeader>
            <CardBody>
              <div className="mb-3">
                <strong>Current Rate Limit:</strong> {currentRateLimit === 'Not set' ? 'Not set' : `${currentRateLimit} per hour`}
              </div>
              <Form>
                <FormGroup>
                  <PropInput
                    label="Rate Limit (per hour)"
                    item={formData}
                    prop="rateLimit"
                    type="number"
                    placeholder="Enter custom rate limit"
                    help="Leave empty to use subscription default. Set a custom value to override."
                    onChange={rerender}
                  />
                </FormGroup>
                <Button
                  color="primary"
                  onClick={handleUpdateRateLimit}
                  disabled={updateMutation.isPending || !formData.rateLimit.trim()}
                >
                  {updateMutation.isPending ? 'Updating...' : 'Update Rate Limit'}
                </Button>
              </Form>
            </CardBody>
          </Card>

          <Card className="mb-4">
            <CardHeader>
              <h5>Retention Period</h5>
            </CardHeader>
            <CardBody>
              <div className="mb-3">
                <strong>Current Retention Period:</strong>{' '}
                {currentRetentionPeriod === 'Not set' ? 'Not set' : `${currentRetentionPeriod} days`}
              </div>
              <Form>
                <FormGroup>
                  <PropInput
                    label="Retention Period (days)"
                    item={formData}
                    prop="retentionPeriod"
                    type="number"
                    placeholder="Enter retention period"
                    help="Leave empty to use subscription default. Set a custom value to override."
                    onChange={rerender}
                  />
                </FormGroup>
                <Button
                  color="primary"
                  onClick={handleUpdateRetentionPeriod}
                  disabled={updateMutation.isPending || !formData.retentionPeriod.trim()}
                >
                  {updateMutation.isPending ? 'Updating...' : 'Update Retention Period'}
                </Button>
              </Form>
            </CardBody>
          </Card>
        </Col>

        <Col md={6}>
          <Card className="mb-4">
            <CardHeader>
              <h5>Other Thresholds</h5>
            </CardHeader>
            <CardBody>
              <Form>
                <FormGroup>
                  <PropInput
                    label="Max Members"
                    item={formData}
                    prop="maxMembers"
                    type="number"
                    placeholder={organisation.max_members?.toString() || 'Not set'}
                    onChange={rerender}
                  />
                </FormGroup>
                <FormGroup>
                  <PropInput
                    label="Max Datasets"
                    item={formData}
                    prop="maxDatasets"
                    type="number"
                    placeholder={organisation.max_datasets?.toString() || 'Not set'}
                    onChange={rerender}
                  />
                </FormGroup>
                <FormGroup>
                  <PropInput
                    label="Experiment Retention (days)"
                    item={formData}
                    prop="experimentRetentionDays"
                    type="number"
                    placeholder={organisation.experiment_retention_days?.toString() || 'Not set'}
                    onChange={rerender}
                  />
                </FormGroup>
                <FormGroup>
                  <PropInput
                    label="Max Examples per Dataset"
                    item={formData}
                    prop="maxExamplesPerDataset"
                    type="number"
                    placeholder={organisation.max_examples_per_dataset?.toString() || 'Not set'}
                    onChange={rerender}
                  />
                </FormGroup>
                <Button
                  color="primary"
                  onClick={handleUpdateAllThresholds}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? 'Updating...' : 'Update Thresholds'}
                </Button>
              </Form>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default AdminPage;


