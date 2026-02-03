import React, { useEffect, useRef } from 'react';
import { Container, Row, Col, Card, CardBody, CardHeader, ListGroup, ListGroupItem } from 'reactstrap';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth0 } from '@auth0/auth0-react';
import { getUserByJWT, listOrganisations, updateCurrentUser } from '../api';
import { Badge } from 'reactstrap';

const ProfilePage: React.FC = () => {
  const { user: auth0User } = useAuth0();

  const { data: user, isLoading, error } = useQuery({
    queryKey: ['user', 'current'],
    queryFn: () => getUserByJWT(),
  });

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

  if (error || !user) {
    return (
      <Container>
        <div className="alert alert-danger">
          <h4>Error</h4>
          <p>Failed to load profile: {error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </Container>
    );
  }

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <h1>Profile</h1>
        </Col>
      </Row>

      <Row className="mt-4">
        <Col md={6}>
          <Card>
            <CardHeader className="d-flex justify-content-between align-items-center">
              <h5 className="mb-0">Profile Information</h5>
              {isSuperAdmin && <Badge color="primary">Super Admin</Badge>}
            </CardHeader>
            <CardBody>
              {auth0User?.picture && (
                <div className="text-center mb-3">
                  <img
                    src={auth0User.picture}
                    alt={user.name || 'Profile'}
                    className="rounded-circle"
                    style={{ width: '120px', height: '120px' }}
                  />
                </div>
              )}
              <ListGroup flush>
                <ListGroupItem>
                  <strong>Name:</strong> {user.name || 'Not set'}
                </ListGroupItem>
                <ListGroupItem>
                  <strong>Email:</strong> {user.email || 'Not set'}
                </ListGroupItem>
                <ListGroupItem>
                  <strong>User ID:</strong> {user.id}
                </ListGroupItem>
                <ListGroupItem>
                  <strong>Auth0 Subject:</strong> {user.sub}
                </ListGroupItem>
                <ListGroupItem>
                  <strong>Created:</strong> {new Date(user.created).toLocaleString()}
                </ListGroupItem>
                <ListGroupItem>
                  <strong>Updated:</strong> {new Date(user.updated).toLocaleString()}
                </ListGroupItem>
              </ListGroup>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default ProfilePage;

