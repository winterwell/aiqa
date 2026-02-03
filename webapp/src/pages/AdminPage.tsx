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
import { getOrganisation, getOrganisationAccount, updateOrganisationAccount } from '../api';
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

  const { data: organisation, isLoading: isLoadingOrg, error } = useQuery({
    queryKey: ['organisation', organisationId],
    queryFn: () => getOrganisation(organisationId!),
    enabled: !!organisationId,
  });

  const { data: account, isLoading: isLoadingAccount } = useQuery({
    queryKey: ['organisationAccount', organisationId],
    queryFn: () => getOrganisationAccount(organisationId!),
    enabled: !!organisationId,
  });

  useEffect(() => {
    if (account) {
      formDataRef.current = {
        subscriptionType: account.subscription?.type || '',
        rateLimit: account.rateLimitPerHour?.toString() || '',
        retentionPeriod: account.retentionPeriodDays?.toString() || '',
        maxMembers: account.maxMembers?.toString() || '',
        maxDatasets: account.maxDatasets?.toString() || '',
        experimentRetentionDays: account.experimentRetentionDays?.toString() || '',
        maxExamplesPerDataset: account.maxExamplesPerDataset?.toString() || '',
      };
      rerender();
    }
  }, [account, rerender]);

  const updateMutation = useMutation({
    mutationFn: ({ accountId, updates }: { accountId: string; updates: Parameters<typeof updateOrganisationAccount>[1] }) =>
      updateOrganisationAccount(accountId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organisationAccount', organisationId] });
      showToast('Organisation updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(`Failed to update organisation: ${error.message}`, 'error');
    },
  });

  const handleUpdateSubscription = () => {
    if (!account) return;
    const subscriptionType = formDataRef.current.subscriptionType;
    if (!subscriptionType) {
      showToast('Please select a subscription type', 'error');
      return;
    }

    const subscriptionUpdate: any = {
      ...account.subscription,
      type: subscriptionType as 'free' | 'trial' | 'pro' | 'enterprise',
    };

    updateMutation.mutate({ accountId: account.id, updates: { subscription: subscriptionUpdate } });
  };

  const handleUpdateRateLimit = () => {
    if (!account) return;
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

    updateMutation.mutate({ accountId: account.id, updates: { rateLimitPerHour: numValue } });
  };

  const handleUpdateRetentionPeriod = () => {
    if (!account) return;
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

    updateMutation.mutate({ accountId: account.id, updates: { retentionPeriodDays: numValue } });
  };

  const handleUpdateAllThresholds = () => {
    if (!account) return;
    const updates: any = {};
    const formData = formDataRef.current;

    if (formData.maxMembers.trim()) {
      const value = parseInt(formData.maxMembers, 10);
      if (!isNaN(value) && value >= 0) updates.maxMembers = value;
    }

    if (formData.maxDatasets.trim()) {
      const value = parseInt(formData.maxDatasets, 10);
      if (!isNaN(value) && value >= 0) updates.maxDatasets = value;
    }

    if (formData.experimentRetentionDays.trim()) {
      const value = parseInt(formData.experimentRetentionDays, 10);
      if (!isNaN(value) && value >= 0) updates.experimentRetentionDays = value;
    }

    if (formData.maxExamplesPerDataset.trim()) {
      const value = parseInt(formData.maxExamplesPerDataset, 10);
      if (!isNaN(value) && value >= 0) updates.maxExamplesPerDataset = value;
    }

    if (Object.keys(updates).length === 0) {
      showToast('Please enter at least one threshold value', 'error');
      return;
    }

    updateMutation.mutate({ accountId: account.id, updates });
  };

  const formData = formDataRef.current;

  const isLoading = isLoadingOrg || isLoadingAccount;
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

  if (error || !organisation || !account) {
    return (
      <Container>
        <Alert color="danger">
          <h4>Error</h4>
          <p>Failed to load organisation: {error instanceof Error ? error.message : 'Unknown error'}</p>
        </Alert>
      </Container>
    );
  }

  const currentSubscriptionType = account.subscription?.type || 'Not set';
  const currentRateLimit = account.rateLimitPerHour ?? 'Not set';
  const currentRetentionPeriod = account.retentionPeriodDays ?? 'Not set';

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


