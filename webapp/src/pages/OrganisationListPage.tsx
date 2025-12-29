import React, { useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, Button, Table, Alert } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { listOrganisations, getOrCreateUser } from '../api';
import Organisation from '../common/types/Organisation';
import CreateOrganisationButton from '../components/generic/CreateOrganisationButton';

const OrganisationListPage: React.FC = () => {
  const { user: auth0User } = useAuth0();
  const navigate = useNavigate();
  const location = useLocation();

  // Get active organisation ID from URL
  const pathBits = location.pathname.split('/');
  const orgIndex = pathBits.indexOf('organisation');
  const activeOrganisationId = orgIndex !== -1 && pathBits[orgIndex + 1] ? pathBits[orgIndex + 1] : null;

  // Get or create the database user to get their ID
  const { data: dbUser, isLoading: isLoadingUser } = useQuery({
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

  // Fetch all organizations
  const { data: allOrganisations, isLoading: isLoadingOrgs, error } = useQuery({
    queryKey: ['organisations'],
    queryFn: () => listOrganisations(),
    enabled: !!dbUser?.id,
  });
  
  useEffect(() => {
    // Auto-navigate to the only organisation if there's exactly one
    if (allOrganisations && allOrganisations.length === 1 && !activeOrganisationId) {
      navigate(`/organisation/${allOrganisations[0].id}`);
    }
  }, [allOrganisations, navigate, activeOrganisationId]);

  if (isLoadingUser || isLoadingOrgs) {
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

  if (error) {
    return (
      <Container className="mt-4">
        <Alert color="danger">
          <h4>Error</h4>
          <p>Failed to load organizations: {error instanceof Error ? error.message : 'Unknown error'}</p>
        </Alert>
      </Container>
    );
  }

  // Show create form if no organizations
  if (allOrganisations && allOrganisations.length === 0 && dbUser?.id) {
    return (
      <Container className="mt-4">
        <Row className="justify-content-center">
          <Col md={8}>
            <Card>
              <CardBody>
                <h3>Welcome to AIQA</h3>
                <p className="lead">You're not a member of any organization yet.</p>
                <p>Create your first organization to get started:</p>
                <CreateOrganisationButton dbUserId={dbUser.id} showFormInline={true} />
              </CardBody>
            </Card>
          </Col>
        </Row>
      </Container>
    );
  }

  // Show list of organizations
  if (!dbUser?.id) {
    return (
      <Container className="mt-4">
        <Alert color="warning">Loading user information...</Alert>
      </Container>
    );
  }

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h1>Organizations</h1>
            <CreateOrganisationButton dbUserId={dbUser.id} />
          </div>
        </Col>
      </Row>

      <Row>
        <Col>
          <Card>
            <CardBody>
              {!allOrganisations || allOrganisations.length === 0 ? (
                <p className="text-muted">No organizations found.</p>
              ) : (
                <Table hover>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Members</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allOrganisations.map((org: Organisation) => {
                      const isActive = activeOrganisationId === org.id;
                      return (
                        <tr 
                          key={org.id}
                          className={isActive ? 'table-active' : ''}
                          style={{ cursor: 'pointer' }}
                          onClick={() => navigate(`/organisation/${org.id}`)}
                        >
                          <td>
                            <strong>{org.name}</strong>
                            {isActive && <span className="badge bg-primary ms-2">Active</span>}
                          </td>
                          <td>{org.members?.length || 0}</td>
                          <td>{new Date(org.created).toLocaleString()}</td>
                          <td>
                            <Button
                              color={isActive ? "success" : "primary"}
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/organisation/${org.id}`);
                              }}
                            >
                              {isActive ? 'Active' : 'Select'}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default OrganisationListPage;

