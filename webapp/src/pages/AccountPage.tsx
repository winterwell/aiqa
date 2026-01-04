import React from 'react';
import { useParams } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, ListGroup, ListGroupItem, Badge, Alert } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { getOrganisation } from '../api';

type SubscriptionPackage = 'Trial' | 'Free' | 'Enterprise';

const AccountPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();

  const { data: organisation, isLoading, error } = useQuery({
    queryKey: ['organisation', organisationId],
    queryFn: () => getOrganisation(organisationId!),
    enabled: !!organisationId,
  });

  // For now, everyone starts on Trial
  // In a real implementation, this would come from the organisation object or a separate subscription API
  const subscriptionPackage: SubscriptionPackage = organisation?.subscription?.type as SubscriptionPackage;

  const getSubscriptionBadgeColor = (pkg: SubscriptionPackage|null) => {
    if (!pkg) {
      return 'secondary';
    }
    switch (pkg) {
      case 'Trial':
        return 'secondary';
      case 'Free':
        return 'info';
      case 'Enterprise':
        return 'success';
      default:
        return 'secondary';
    }
  };

  const getSubscriptionDescription = (pkg: SubscriptionPackage|null) => {
    if (!pkg) {
      return '';
    }
    switch (pkg) {
      case 'Trial':
        return 'You are currently on a Trial plan. Send feedback to upgrade to Free or contact us for Enterprise.';
      case 'Free':
        return 'You are on the Free plan. Contact us to upgrade to Enterprise.';
      case 'Enterprise':
        return 'You are on the Enterprise plan.';
      default:
        return '';
    }
  };

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
        <div className="alert alert-danger">
          <h4>Error</h4>
          <p>Failed to load account: {error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </Container>
    );
  }

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <h1>Account</h1>
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
                <h6>
                  Current Plan:{' '}
                  <Badge color={getSubscriptionBadgeColor(subscriptionPackage)}>
                    {subscriptionPackage ?? 'Unknown'}
                  </Badge>
                </h6>
                <p className="text-muted">{getSubscriptionDescription(subscriptionPackage)}</p>
              </div>
              {subscriptionPackage === 'Trial' && (
                <Alert color="info">
                  <strong>Upgrade Options:</strong>
                  <ul className="mb-0 mt-2">
                    <li>Send feedback to upgrade to <strong>Free</strong> plan</li>
                    <li>Contact us for <strong>Enterprise</strong> plan</li>
                  </ul>
                </Alert>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h5>Organisation Details</h5>
            </CardHeader>
            <CardBody>
              <ListGroup flush>
                <ListGroupItem>
                  <strong>Name:</strong> {organisation.name}
                </ListGroupItem>
                <ListGroupItem>
                  <strong>Organisation ID:</strong> {organisation.id}
                </ListGroupItem>
                <ListGroupItem>
                  <strong>Rate Limit:</strong>{' '}
                  {organisation.rate_limit_per_hour
                    ? `${organisation.rate_limit_per_hour} per hour`
                    : 'Not set'}
                </ListGroupItem>
                <ListGroupItem>
                  <strong>Retention Period:</strong>{' '}
                  {organisation.retention_period_days
                    ? `${organisation.retention_period_days} days`
                    : 'Not set'}
                </ListGroupItem>
                <ListGroupItem>
                  <strong>Members:</strong> {organisation.members?.length || 0}
                </ListGroupItem>
                <ListGroupItem>
                  <strong>Created:</strong> {new Date(organisation.created).toLocaleString()}
                </ListGroupItem>
                <ListGroupItem>
                  <strong>Updated:</strong> {new Date(organisation.updated).toLocaleString()}
                </ListGroupItem>
              </ListGroup>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default AccountPage;

