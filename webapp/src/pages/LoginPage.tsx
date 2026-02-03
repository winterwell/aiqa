import React from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { Container, Row, Col, Card, Button } from 'reactstrap';
import Logo from '../components/Logo';

import { useNavigate } from 'react-router-dom';
import { getOrCreateUser, getUserByJWT } from '../api';

const LoginPage: React.FC = () => {
  const { loginWithRedirect, isAuthenticated, user } = useAuth0();
  const navigate = useNavigate();
  
  // Fetch User object from server - or create a new User on the server before navigating
  React.useEffect(() => {
    const fetchUserAndNavigate = async () => {
      try {
        // When Auth0 omits email (e.g. some Google OAuth configs), try existing user by JWT first
        if (!user?.email) {
          try {
            const dbUser = await getUserByJWT();
            if (dbUser) {
              navigate('/organisation');
              return;
            }
          } catch {
            // No user yet; need email for first-time create
          }
          console.error("No email found in Auth0 user object - cannot create new user");
          return;
        }

        const dbUser = await getOrCreateUser(
          user.email,
          user.name || user.email,
        );
        console.log("User fetched/created:", dbUser);

        const organisationId = dbUser?.organisation || user?.organisation;
        if (organisationId) {
          navigate(`/organisation/${organisationId}`);
        } else {
          navigate(`/organisation`);
        }
      } catch (err) {
        console.error("Error fetching user or organisation:", err);
      }
    };

    if (isAuthenticated && user) {
      fetchUserAndNavigate();
    }
  }, [isAuthenticated, user, navigate]);

  if (isAuthenticated) {
    return (
      <Container className="mt-5">
        <Row className="justify-content-center">
          <Col md={6}>
            <Card className="p-4">
              <div className="d-flex justify-content-center mb-3">
                <Logo size={48} showText={true} />
              </div>
              <h2 className="mb-4">Welcome, {user?.name || user?.email}!</h2>
              <p>You are logged in. Next step: Your Organisation.</p>
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
            <div className="d-flex justify-content-center mb-4">
              <Logo size={64} showText={true} />
            </div>
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

