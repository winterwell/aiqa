import React, { useState } from 'react';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  ListGroup,
  ListGroupItem,
  Alert,
  Badge,
} from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { XIcon, UserPlusIcon } from '@phosphor-icons/react';
import Organisation from '../common/types/Organisation';
import { listUsers, updateOrganisation, getUser } from '../api';

interface User {
  id: string;
  email?: string;
  name?: string;
}

interface ManageMembersModalProps {
  isOpen: boolean;
  toggle: () => void;
  organisation: Organisation;
}

export default function ManageMembersModal({
  isOpen,
  toggle,
  organisation,
}: ManageMembersModalProps) {
  const queryClient = useQueryClient();
  const [emailInput, setEmailInput] = useState('');

  // Helper to invalidate organisation queries (DRY)
  const invalidateOrganisation = () => {
    queryClient.invalidateQueries({ queryKey: ['organisation', organisation.id] });
  };

  // Fetch user details for member IDs
  const memberIds = organisation.members || [];
  const { data: memberUsers } = useQuery({
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
    enabled: isOpen && memberIds.length > 0,
  });

  const addMemberMutation = useMutation({
    mutationFn: async (email: string) => {
      const emailLower = email.trim().toLowerCase();
      
      // First, try to find the user by email
      const users = await listUsers(`email:${emailLower}`);
      
      // Get current state with defaults (DRY)
      const currentMembers = organisation.members || [];
      const currentPendingMembers = organisation.pending_members || [];
      const currentMemberSettings = organisation.member_settings || {};
      
      if (users.length > 0) {
        // User exists - add to members
        const user = users[0];
        
        if (currentMembers.includes(user.id)) {
          throw new Error('User is already a member of this organisation');
        }

        const updatedMembers = [...currentMembers, user.id];
        const updatedMemberSettings = {
          ...currentMemberSettings,
          [user.id]: currentMemberSettings[user.id] || { role: 'standard' },
        };
        
        // Remove from pending if it was there
        const updatedPendingMembers = currentPendingMembers.filter(e => e.toLowerCase() !== emailLower);

        return updateOrganisation(organisation.id, {
          members: updatedMembers,
          pending_members: updatedPendingMembers,
          member_settings: updatedMemberSettings,
        });
      } else {
        // User doesn't exist - add to pending_members
        if (currentPendingMembers.some(e => e.toLowerCase() === emailLower)) {
          throw new Error('This email is already pending invitation');
        }

        const updatedPendingMembers = [...currentPendingMembers, emailLower];

        return updateOrganisation(organisation.id, {
          pending_members: updatedPendingMembers,
        });
      }
    },
    onSuccess: () => {
      invalidateOrganisation();
      setEmailInput('');
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      const currentMembers = organisation.members || [];
      const currentMemberSettings = organisation.member_settings || {};

      if (!currentMembers.includes(userId)) {
        return organisation; // Not a member
      }

      // Safety check: prevent removing the last member
      if (currentMembers.length <= 1) {
        throw new Error('Cannot remove the last member from the organisation');
      }

      const updatedMembers = currentMembers.filter((id) => id !== userId);
      const updatedMemberSettings = { ...currentMemberSettings };
      delete updatedMemberSettings[userId];

      return updateOrganisation(organisation.id, {
        members: updatedMembers,
        member_settings: updatedMemberSettings,
      });
    },
    onSuccess: invalidateOrganisation,
  });

  const removePendingMemberMutation = useMutation({
    mutationFn: async (email: string) => {
      const emailLower = email.trim().toLowerCase();
      const currentPendingMembers = organisation.pending_members || [];
      const updatedPendingMembers = currentPendingMembers.filter(
        e => e.toLowerCase() !== emailLower
      );

      return updateOrganisation(organisation.id, {
        pending_members: updatedPendingMembers,
      });
    },
    onSuccess: invalidateOrganisation,
  });

  const members = memberUsers || memberIds.map((id) => ({ id }));
  const pendingMembers = organisation.pending_members || [];

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim()) return;
    addMemberMutation.mutate(emailInput.trim());
  };

  const handleRemoveMember = (userId: string) => {
    const currentMembers = organisation.members || [];
    if (currentMembers.length <= 1) {
      alert('Cannot remove the last member from the organisation');
      return;
    }
    if (window.confirm('Are you sure you want to remove this member?')) {
      removeMemberMutation.mutate(userId);
    }
  };

  const handleRemovePendingMember = (email: string) => {
    if (window.confirm(`Are you sure you want to remove the pending invitation for ${email}?`)) {
      removePendingMemberMutation.mutate(email);
    }
  };

  const handleClose = () => {
    setEmailInput('');
    toggle();
  };

  return (
    <Modal isOpen={isOpen} toggle={handleClose} size="lg">
      <ModalHeader toggle={handleClose}>Manage Members</ModalHeader>
      <ModalBody>
        <div className="mb-4">
          <h6>Add Member</h6>
          <form onSubmit={handleAddMember}>
            <div className="d-flex gap-2">
              <Input
                type="email"
                placeholder="Enter email address..."
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="flex-grow-1"
                required
              />
              <Button
                type="submit"
                color="primary"
                disabled={addMemberMutation.isPending || !emailInput.trim()}
              >
                <UserPlusIcon size={16} className="me-1" />
                {addMemberMutation.isPending ? 'Adding...' : 'Add'}
              </Button>
            </div>
          </form>
          {addMemberMutation.isError && (
            <Alert color="danger" className="mt-2 py-2">
              Failed to add member:{' '}
              {addMemberMutation.error instanceof Error
                ? addMemberMutation.error.message
                : 'Unknown error'}
            </Alert>
          )}
        </div>

        <div>
          <h6>Current Members ({members.length})</h6>
          {members.length === 0 ? (
            <Alert color="info" className="py-2">
              No members yet. Add members by entering their email above.
            </Alert>
          ) : (
            <ListGroup>
              {members.map((member: User) => {
                const memberSettings = organisation.member_settings?.[member.id];
                return (
                  <ListGroupItem
                    key={member.id}
                    className="d-flex justify-content-between align-items-center"
                  >
                    <div>
                      <div>
                        {member.name || member.email || 'Unknown'}
                        {member.email && member.name && (
                          <span className="text-muted ms-2">({member.email})</span>
                        )}
                        {memberSettings && (
                          <Badge color={memberSettings.role === 'admin' ? 'primary' : 'secondary'} className="ms-2">
                            {memberSettings.role}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      color="danger"
                      size="sm"
                      onClick={() => handleRemoveMember(member.id)}
                      disabled={removeMemberMutation.isPending || members.length <= 1}
                      title={members.length <= 1 ? 'Cannot remove the last member' : 'Remove member'}
                    >
                      <XIcon size={16} />
                    </Button>
                  </ListGroupItem>
                );
              })}
            </ListGroup>
          )}
          {removeMemberMutation.isError && (
            <Alert color="danger" className="mt-2 py-2">
              Failed to remove member:{' '}
              {removeMemberMutation.error instanceof Error
                ? removeMemberMutation.error.message
                : 'Unknown error'}
            </Alert>
          )}
        </div>

        {pendingMembers.length > 0 && (
          <div className="mt-4">
            <h6>Pending Invitations ({pendingMembers.length})</h6>
            <Alert color="info" className="py-2 mb-3">
              These users will be automatically added when they sign up.
            </Alert>
            <ListGroup>
              {pendingMembers.map((email: string) => (
                <ListGroupItem
                  key={email}
                  className="d-flex justify-content-between align-items-center"
                >
                  <div>
                    <div>
                      {email}
                      <Badge color="warning" className="ms-2">
                        Pending
                      </Badge>
                    </div>
                  </div>
                  <Button
                    color="danger"
                    size="sm"
                    onClick={() => handleRemovePendingMember(email)}
                    disabled={removePendingMemberMutation.isPending}
                    title="Remove pending invitation"
                  >
                    <XIcon size={16} />
                  </Button>
                </ListGroupItem>
              ))}
            </ListGroup>
            {removePendingMemberMutation.isError && (
              <Alert color="danger" className="mt-2 py-2">
                Failed to remove pending invitation:{' '}
                {removePendingMemberMutation.error instanceof Error
                  ? removePendingMemberMutation.error.message
                  : 'Unknown error'}
              </Alert>
            )}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button color="secondary" onClick={handleClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}

