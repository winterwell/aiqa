export interface User {
  id: string;
  email: string;
  name: string;
  sub?: string; // Auth0 subject identifier (e.g., "google-oauth2|109424848053592856653")
  created: Date;
  updated: Date;
}

