import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, CardBody, CardHeader, Form, FormGroup, Label, Input, Alert } from 'reactstrap';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon } from '@phosphor-icons/react';
import { createOrganisation } from '../../api';

interface CreateOrganisationButtonProps {
  dbUserId: string;
  buttonText?: string;
  showFormInline?: boolean;
  onSuccess?: (newOrg: any) => void;
}

export default function CreateOrganisationButton({
  dbUserId,
  buttonText = '+ Add organisation',
  showFormInline = false,
  onSuccess,
}: CreateOrganisationButtonProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(showFormInline);
  const [orgName, setOrgName] = useState('');

  const createOrgMutation = useMutation({
    mutationFn: async (orgData: { name: string; members: string[] }) => {
      return createOrganisation(orgData);
    },
    onSuccess: (newOrg) => {
      queryClient.invalidateQueries({ queryKey: ['organisations'] });
      queryClient.invalidateQueries({ queryKey: ['organisation', newOrg.id] });
      setShowForm(false);
      setOrgName('');
      if (onSuccess) {
        onSuccess(newOrg);
      } else {
        navigate(`/organisation/${newOrg.id}`);
      }
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dbUserId || !orgName.trim()) return;

    createOrgMutation.mutate({
      name: orgName.trim(),
      members: [dbUserId],
    });
  };

  const handleCancel = () => {
    setShowForm(false);
    setOrgName('');
  };

  if (showFormInline && showForm) {
    return (
      <Card>
        <CardHeader>
          <h5>Create New Organization</h5>
        </CardHeader>
        <CardBody>
          <Form onSubmit={handleSubmit}>
            <FormGroup>
              <Label for="orgName">Organization Name</Label>
              <Input
                type="text"
                id="orgName"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Enter organization name"
                required
                autoFocus
              />
            </FormGroup>
            <div className="d-flex gap-2">
              <Button color="primary" type="submit" disabled={createOrgMutation.isPending}>
                {createOrgMutation.isPending ? 'Creating...' : 'Create Organization'}
              </Button>
            </div>
            {createOrgMutation.isError && (
              <Alert color="danger" className="mt-3">
                Failed to create organization:{' '}
                {createOrgMutation.error instanceof Error
                  ? createOrgMutation.error.message
                  : 'Unknown error'}
              </Alert>
            )}
          </Form>
        </CardBody>
      </Card>
    );
  }

  return (
    <>
      <Button color="primary" onClick={() => setShowForm(true)}>
        <PlusIcon size={20} className="me-1" />
        {buttonText}
      </Button>
      {showForm && (
        <Card className="mt-3">
          <CardHeader>
            <h5>Create New Organization</h5>
          </CardHeader>
          <CardBody>
            <Form onSubmit={handleSubmit}>
              <FormGroup>
                <Label for="orgName">Organization Name</Label>
                <Input
                  type="text"
                  id="orgName"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Enter organization name"
                  required
                  autoFocus
                />
              </FormGroup>
              <div className="d-flex gap-2">
                <Button color="primary" type="submit" disabled={createOrgMutation.isPending}>
                  {createOrgMutation.isPending ? 'Creating...' : 'Create Organization'}
                </Button>
                <Button color="secondary" onClick={handleCancel}>
                  Cancel
                </Button>
              </div>
              {createOrgMutation.isError && (
                <Alert color="danger" className="mt-3">
                  Failed to create organization:{' '}
                  {createOrgMutation.error instanceof Error
                    ? createOrgMutation.error.message
                    : 'Unknown error'}
                </Alert>
              )}
            </Form>
          </CardBody>
        </Card>
      )}
    </>
  );
}
