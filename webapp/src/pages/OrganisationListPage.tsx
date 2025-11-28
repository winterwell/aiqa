import React, { useState, useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useNavigate } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, Button, Form, FormGroup, Label, Input, Table, Alert } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listOrganisations, createOrganisation, getOrCreateUser } from '../api';
import { Organisation } from '../common/types/Organisation';

const OrganisationListPage: React.FC = () => {
  const { user: auth0User } = useAuth0();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [orgName, setOrgName] = useState('');

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
    queryFn: () => listOrganisations("members:" + dbUser?.id),
	enabled: !!dbUser?.id,
  });
  useEffect(() => {
    if (allOrganisations && allOrganisations.length === 1) {
      navigate(`/organisation/${allOrganisations[0].id}`);
    }
  }, [allOrganisations, navigate]);

  // Filter organizations where the user is a member
  const userOrganisations = React.useMemo(() => {
    if (!allOrganisations || !dbUser) return [];
    return allOrganisations.filter((org: Organisation) => 
      org.members && org.members.includes(dbUser.id)
    );
  }, [allOrganisations, dbUser]);

  // Create organisation mutation
  const createOrgMutation = useMutation({
    mutationFn: async (orgData: { name: string; members: string[] }) => {
      return createOrganisation(orgData);
    },
    onSuccess: (newOrg) => {
      queryClient.invalidateQueries({ queryKey: ['organisations'] });
      setShowCreateForm(false);
      setOrgName('');
      navigate(`/organisation/${newOrg.id}`);
    },
  });

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dbUser || !orgName.trim()) return;

    createOrgMutation.mutate({
      name: orgName.trim(),
      members: [dbUser.id],
    });
  };

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
  if (userOrganisations.length === 0 && !showCreateForm) {
    return (
      <Container className="mt-4">
        <Row className="justify-content-center">
          <Col md={8}>
            <Card>
              <CardHeader>
                <h3>Welcome to AIQA</h3>
              </CardHeader>
              <CardBody>
                <p className="lead">You're not a member of any organization yet.</p>
                <p>Create your first organization to get started:</p>
                <Form onSubmit={handleCreateOrg}>
                  <FormGroup>
                    <Label for="orgName">Organization Name</Label>
                    <Input
                      type="text"
                      id="orgName"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="Enter organization name"
                      required
                    />
                  </FormGroup>
                  <div className="d-flex gap-2">
                    <Button color="primary" type="submit" disabled={createOrgMutation.isPending}>
                      {createOrgMutation.isPending ? 'Creating...' : 'Create Organization'}
                    </Button>
                  </div>
                  {createOrgMutation.isError && (
                    <Alert color="danger" className="mt-3">
                      Failed to create organization: {createOrgMutation.error instanceof Error ? createOrgMutation.error.message : 'Unknown error'}
                    </Alert>
                  )}
                </Form>
              </CardBody>
            </Card>
          </Col>
        </Row>
      </Container>
    );
  }

  // Show list of organizations
  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h1>Organizations</h1>
            <Button color="primary" onClick={() => setShowCreateForm(true)}>
              Create Organization
            </Button>
          </div>
        </Col>
      </Row>

      {showCreateForm && (
        <Row className="mb-4">
          <Col>
            <Card>
              <CardHeader>
                <h5>Create New Organization</h5>
              </CardHeader>
              <CardBody>
                <Form onSubmit={handleCreateOrg}>
                  <FormGroup>
                    <Label for="orgName">Organization Name</Label>
                    <Input
                      type="text"
                      id="orgName"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="Enter organization name"
                      required
                    />
                  </FormGroup>
                  <div className="d-flex gap-2">
                    <Button color="primary" type="submit" disabled={createOrgMutation.isPending}>
                      {createOrgMutation.isPending ? 'Creating...' : 'Create Organization'}
                    </Button>
                    <Button color="secondary" onClick={() => {
                      setShowCreateForm(false);
                      setOrgName('');
                    }}>
                      Cancel
                    </Button>
                  </div>
                  {createOrgMutation.isError && (
                    <Alert color="danger" className="mt-3">
                      Failed to create organization: {createOrgMutation.error instanceof Error ? createOrgMutation.error.message : 'Unknown error'}
                    </Alert>
                  )}
                </Form>
              </CardBody>
            </Card>
          </Col>
        </Row>
      )}

      <Row>
        <Col>
          <Card>
            <CardBody>
              {userOrganisations.length === 0 ? (
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
                    {userOrganisations.map((org: Organisation) => (
                      <tr key={org.id}>
                        <td>
                          <strong>{org.name}</strong>
                        </td>
                        <td>{org.members?.length || 0}</td>
                        <td>{new Date(org.created).toLocaleString()}</td>
                        <td>
                          <Button
                            color="primary"
                            size="sm"
                            onClick={() => navigate(`/organisation/${org.id}`)}
                          >
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
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

