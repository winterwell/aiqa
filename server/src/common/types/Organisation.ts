type MemberSettings = {
  role: "admin" | "standard";
}


/**
 * See OrganisationAccount for subscription and retention period details.
 */
export default interface Organisation {
  id: string;
  name: string;
  
  /** User ids of members of the organisation. Must contain the current user's id. */
  members: string[];
  /** Email addresses of users invited but not yet registered. Auto-added to members when they sign up. */
  pending?: string[];
  /** user id to user-specific settings for the organisation */
  memberSettings?: Record<string, MemberSettings>;
  created: Date;
  updated: Date;
}

