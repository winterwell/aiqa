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
  /** user id to user-specific settings for the organisation */
  member_settings?: Record<string, MemberSettings>;
  created: Date;
  updated: Date;
}

