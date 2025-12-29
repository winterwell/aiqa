import React from 'react';
import { useParams } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, ListGroup, ListGroupItem } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { useAuth0 } from '@auth0/auth0-react';
import { getOrganisation, getOrCreateUser } from '../api';
import CreateOrganisationButton from '../components/generic/CreateOrganisationButton';

const OrganisationPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const { user: auth0User } = useAuth0();

  const { data: organisation, isLoading, error } = useQuery({
    queryKey: ['organisation', organisationId],
    queryFn: () => getOrganisation(organisationId!),
    enabled: !!organisationId,
  });

  const { data: dbUser } = useQuery({
    queryKey: ['user', auth0User?.email],
    queryFn: async () => {
      if (!auth0User?.email) return null;
      return getOrCreateUser(
        auth0User.email,
        auth0User.name || auth0User.email
      );
    },
    enabled: !!auth0User?.email,
  });

  if (isLoading) {
    return (
      <Container className="mt-4">
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
      <Container className="mt-4">
        <div className="alert alert-danger">
          <h4>Error</h4>
          <p>Failed to load organisation: {error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </Container>
    );
  }

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <h1>{organisation.name}</h1>
              <p className="text-muted">Organisation ID: {organisation.id}</p>
            </div>
            {dbUser?.id && <CreateOrganisationButton dbUserId={dbUser.id} />}
          </div>
        </Col>
      </Row>

      <Row className="mt-4">
        <Col md={6}>
          <Card>
            <CardHeader>
              <h5>Organisation Details</h5>
            </CardHeader>
            <CardBody>
              <ListGroup flush>
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
                  <strong>Created:</strong>{' '}
                  {new Date(organisation.created).toLocaleString()}
                </ListGroupItem>
                <ListGroupItem>
                  <strong>Updated:</strong>{' '}
                  {new Date(organisation.updated).toLocaleString()}
                </ListGroupItem>
              </ListGroup>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default OrganisationPage;

