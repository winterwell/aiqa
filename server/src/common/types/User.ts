export default interface User {
  id: string;
  email?: string;
  name?: string;
  /** Auth0 subject identifier (e.g., "google-oauth2|109424848053592856653") */
  sub: string;
  created: Date;
  updated: Date;
  isSuperAdmin?: boolean;
}

