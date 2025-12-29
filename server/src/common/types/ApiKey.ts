export default interface ApiKey {
  id: string;
  organisation: string;
  /**
   * Optional name for the API key (for easier identification).
   */
  name?: string;
  /**
   * The actual API key. This is NOT stored in the database.
   * Only present temporarily in the frontend when generating a new key.
   */
  key?: string;
  /**
   * Only the hash of the API key is stored in the database.
   * This is used to authenticate requests.
   * Hash algorithm: sha256
   */
  key_hash: string;
  rate_limit_per_hour?: number;
  retention_period_days?: number;
  /** Role of the API key: 'trace' (can only post spans), 'developer' (most endpoints), or 'admin' (all endpoints) */
  role: 'trace' | 'developer' | 'admin';
  created: Date;
  updated: Date;
}

