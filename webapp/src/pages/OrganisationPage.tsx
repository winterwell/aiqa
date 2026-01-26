import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, ListGroup, ListGroupItem, Alert, Button } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { useAuth0 } from '@auth0/auth0-react';
import { Users as UsersIcon } from '@phosphor-icons/react';
import { getOrganisation, getOrCreateUser, listOrganisations, getUser, getOrganisationAccount } from '../api';
import CreateOrganisationButton from '../components/generic/CreateOrganisationButton';
import ManageMembersModal from '../components/ManageMembersModal';

const OrganisationPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const { user: auth0User } = useAuth0();
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);

  const { data: organisation, isLoading, error } = useQuery({
    queryKey: ['organisation', organisationId],
    queryFn: () => getOrganisation(organisationId!),
    enabled: !!organisationId,
  });

  // Fetch user details for member IDs
  const memberIds = organisation?.members || [];
  const { data: memberUsers, isLoading: isLoadingMembers } = useQuery({
    queryKey: ['users-by-ids', memberIds.join(',')],
    queryFn: async () => {
      if (memberIds.length === 0) return [];
      const userPromises = memberIds.map(async (id) => {
        try {
          return await getUser(id);
        } catch {
          return { id, email: undefined, name: undefined };
        }
      });
      return Promise.all(userPromises);
    },
    enabled: !!organisation && memberIds.length > 0,
  });

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

  // Check if user has any organizations when there's an error or no organisationId
  const shouldCheckOrganisations = (!organisationId || error || !organisation) && !!dbUser?.id;
  const { data: allOrganisations, isLoading: isLoadingOrgs } = useQuery({
    queryKey: ['organisations'],
    queryFn: () => listOrganisations(),
    enabled: shouldCheckOrganisations,
  });

  // Fetch OrganisationAccount
  const { data: organisationAccount, isLoading: isLoadingAccount } = useQuery({
    queryKey: ['organisationAccount', organisationId],
    queryFn: () => getOrganisationAccount(organisationId!),
    enabled: !!organisationId,
  });

  // Check if user is super admin (member of AIQA organisation)
  const isSuperAdmin = allOrganisations?.some(org => org.name === 'AIQA') || false;

  if (isLoading || isLoadingUser || (shouldCheckOrganisations && isLoadingOrgs)) {
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

  // If no organisationId or error, check if user has any organizations
  if (!organisationId || error || !organisation) {
    // If user has no organizations, show create form
    if (allOrganisations && allOrganisations.length === 0 && dbUser?.id) {
      return (
        <Container>
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

    // If user has organizations but this one doesn't exist, show error
    return (
      <Container>
        <Alert color="danger">
          <h4>Error</h4>
          <p>Failed to load organisation: {error instanceof Error ? error.message : 'Unknown error'}</p>
          {!organisationId && (
            <p className="mt-2">Please select an organization from the list or create a new one.</p>
          )}
        </Alert>
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
            <div className="d-flex gap-2 align-items-center">
              <Button color="secondary" tag={Link} to={`/organisation/${organisationId}/account`}>
                Account
              </Button>
              {dbUser?.id && <CreateOrganisationButton dbUserId={dbUser.id} />}
            </div>
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
      <Row className="mt-4">
        <Col md={6}>
          <Card>
            <CardHeader className="d-flex justify-content-between align-items-center">
              <h5>Members</h5>
              <Button color="primary" size="sm" onClick={() => setIsMembersModalOpen(true)}>
                <UsersIcon size={16} className="me-1" />
                Manage Members
              </Button>
            </CardHeader>
            <CardBody>
              {isLoadingMembers ? (
                <div className="text-muted">Loading members...</div>
              ) : !memberUsers || memberUsers.length === 0 ? (
                <Alert color="info" className="mb-0">
                  No members yet. Click "Manage Members" to add members.
                </Alert>
              ) : (
                <ListGroup flush>
                  {memberUsers.map((member: { id: string; email?: string; name?: string }) => {
                    const memberSettings = organisation.member_settings?.[member.id];
                    return (
                      <ListGroupItem key={member.id}>
                        <div>
                          <div>
                            {member.name || member.email || 'Unknown'}
                            {member.email && member.name && (
                              <span className="text-muted ms-2">({member.email})</span>
                            )}
                            {memberSettings && (
                              <span className="badge bg-secondary ms-2">{memberSettings.role}</span>
                            )}
                          </div>
                        </div>
                      </ListGroupItem>
                    );
                  })}
                </ListGroup>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      {organisation && (
        <ManageMembersModal
          isOpen={isMembersModalOpen}
          toggle={() => setIsMembersModalOpen(false)}
          organisation={organisation}
        />
      )}
    </Container>
  );
};

export default OrganisationPage;

