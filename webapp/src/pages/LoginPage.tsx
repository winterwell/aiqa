import React from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useNavigate } from 'react-router-dom';
import { Container, Row, Col, Card, Button } from 'reactstrap';

const LoginPage: React.FC = () => {
  const { loginWithRedirect, isAuthenticated, user } = useAuth0();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (isAuthenticated && user) {
      // After login, try to find user's organisations and redirect
      // For now, we'll need the user to navigate manually or we could fetch organisations here
      // This is a placeholder - you may want to fetch organisations and redirect to the first one
    }
  }, [isAuthenticated, user, navigate]);

  if (isAuthenticated) {
    return (
      <Container className="mt-5">
        <Row className="justify-content-center">
          <Col md={6}>
            <Card className="p-4">
              <h2 className="mb-4">Welcome, {user?.name || user?.email}!</h2>
              <p>You are logged in. Please navigate to an organisation to continue.</p>
              <p className="text-muted">
                URL format: /organisation/:organisationId
              </p>
            </Card>
          </Col>
        </Row>
      </Container>
    );
  }

  return (
    <Container className="mt-5">
      <Row className="justify-content-center">
        <Col md={6}>
          <Card className="p-5 text-center">
            <h1 className="mb-4">AIQA</h1>
            <p className="lead mb-4">Welcome to AIQA - AI Quality Assurance Platform</p>
            <Button color="primary" size="lg" onClick={() => loginWithRedirect()}>
              Login with Auth0
            </Button>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default LoginPage;

