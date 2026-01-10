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
      // First, find the user by email
      const users = await listUsers(`email:${email.trim()}`);
      if (users.length === 0) {
        throw new Error(`No user found with email: ${email}`);
      }
      const user = users[0];

      const currentMembers = organisation.members || [];
      const currentMemberSettings = organisation.member_settings || {};
      
      if (currentMembers.includes(user.id)) {
        throw new Error('User is already a member of this organisation');
      }

      const updatedMembers = [...currentMembers, user.id];
      const updatedMemberSettings = {
        ...currentMemberSettings,
        [user.id]: currentMemberSettings[user.id] || { role: 'standard' },
      };

      return updateOrganisation(organisation.id, {
        members: updatedMembers,
        member_settings: updatedMemberSettings,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organisation', organisation.id] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organisation', organisation.id] });
    },
  });

  const members = memberUsers || memberIds.map((id) => ({ id }));

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
      </ModalBody>
      <ModalFooter>
        <Button color="secondary" onClick={handleClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}

