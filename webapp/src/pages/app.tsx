import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setTokenGetter } from '../api';
import 'bootstrap/dist/css/bootstrap.min.css';
import '../custom.css';
import '../utils/animations.css';
import '../components/CelebrationModal.css';
import LoginPage from './LoginPage';
import OrganisationPage from './OrganisationPage';
import OrganisationListPage from './OrganisationListPage';
import TracesListPage from './TracesListPage';
import TraceDetailsPage from './TraceDetailsPage';
import DatasetListPage from './DatasetListPage';
import DatasetDetailsPage from './DatasetDetailsPage';
import ExperimentsListPage from './ExperimentsListPage';
import ExperimentDetailsPage from './ExperimentDetailsPage';
import ApiKeyPage from './ApiKeyPage';
import CodeSetupPage from './CodeSetupPage';
import ExperimentCodePage from './ExperimentCodePage';
import MetricsPage from './MetricsPage';
import ProfilePage from './ProfilePage';
import AccountPage from './AccountPage';
import AdminPage from './AdminPage';
import AboutPage from './AboutPage';
import Layout from './Layout';
import { ToastProvider } from '../utils/toast';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const auth0Domain = import.meta.env.VITE_AUTH0_DOMAIN || '';
const auth0ClientId = import.meta.env.VITE_AUTH0_CLIENT_ID || '';
const auth0Audience = import.meta.env.VITE_AUTH0_AUDIENCE || '';

// Component to set up Auth0 token getter for API calls
const Auth0TokenSetup: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { getAccessTokenSilently } = useAuth0();
  const cacheClearedRef = React.useRef(false);

  React.useEffect(() => {
    setTokenGetter(async () => {
      try {
        if (auth0Audience) {
          return await getAccessTokenSilently({
            authorizationParams: {
              audience: auth0Audience,
            },
          });
        }
        return await getAccessTokenSilently();
      } catch (error: any) {
        // Check if it's a refresh token error
        const errorMessage = error?.message || error?.toString() || '';
        if ((errorMessage.includes('Missing Refresh Token') || errorMessage.includes('refresh_token')) && !cacheClearedRef.current) {
          cacheClearedRef.current = true;
          console.warn('Refresh token issue detected. Clearing Auth0 cache and reloading...');
          // Clear all Auth0-related localStorage entries
          Object.keys(localStorage).forEach(key => {
            if (key.includes('@@auth0spajs@@') || key.includes('auth0')) {
              localStorage.removeItem(key);
            }
          });
          // Reload page to trigger fresh authentication
          setTimeout(() => {
            window.location.reload();
          }, 100);
          return undefined;
        }
        // Re-throw other errors
        throw error;
      }
    });
  }, [getAccessTokenSilently]);

  return <>{children}</>;
};

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth0();

  if (isLoading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
        <div className="spinner-border" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect to website if not authenticated
    window.location.href = 'https://aiqa.winterwell.com';
    return null;
  }

  return <Layout>{children}</Layout>;
};

const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
	  <Route
        path="/organisation"
        element={
          <ProtectedRoute>
            <OrganisationListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/organisation/:organisationId"
        element={
          <ProtectedRoute>
            <OrganisationPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/organisation/:organisationId/api-key"
        element={
          <ProtectedRoute>
            <ApiKeyPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/organisation/:organisationId/code-setup"
        element={
          <ProtectedRoute>
            <CodeSetupPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/organisation/:organisationId/experiment-code"
        element={
          <ProtectedRoute>
            <ExperimentCodePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/organisation/:organisationId/metrics"
        element={
          <ProtectedRoute>
            <MetricsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/organisation/:organisationId/traces"
        element={
          <ProtectedRoute>
            <TracesListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/organisation/:organisationId/traces/:traceId"
        element={
          <ProtectedRoute>
            <TraceDetailsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/organisation/:organisationId/dataset"
        element={
          <ProtectedRoute>
            <DatasetListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/organisation/:organisationId/dataset/:datasetId"
        element={
          <ProtectedRoute>
            <DatasetDetailsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/organisation/:organisationId/experiment"
        element={
          <ProtectedRoute>
            <ExperimentsListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/organisation/:organisationId/experiment/:experimentId"
        element={
          <ProtectedRoute>
            <ExperimentDetailsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/organisation/:organisationId/account"
        element={
          <ProtectedRoute>
            <AccountPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/organisation/:organisationId/admin"
        element={
          <ProtectedRoute>
            <AdminPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/about"
        element={
          <ProtectedRoute>
            <AboutPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const App: React.FC = () => {
  if (!auth0Domain || !auth0ClientId) {
    return (
      <div className="container mt-5">
        <div className="alert alert-danger">
          <h4>Configuration Error</h4>
          <p>Please set VITE_AUTH0_DOMAIN and VITE_AUTH0_CLIENT_ID environment variables.</p>
        </div>
      </div>
    );
  }

  return (
    <Auth0Provider
      domain={auth0Domain}
      clientId={auth0ClientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: auth0Audience,
        scope: 'openid profile email offline_access',
      }}
      useRefreshTokens={true}
      cacheLocation="localstorage"
    >
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BrowserRouter>
            <Auth0TokenSetup>
              <AppRoutes />
            </Auth0TokenSetup>
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </Auth0Provider>
  );
};

export default App;

