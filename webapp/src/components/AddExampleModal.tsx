import React, { useState, useEffect } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter, Form, FormGroup, Label, Input, Button } from 'reactstrap';

interface AddExampleModalProps {
  isOpen: boolean;
  toggle: () => void;
  onSave: (input: string, tags: string[]) => void;
}

const AddExampleModal: React.FC<AddExampleModalProps> = ({
  isOpen,
  toggle,
  onSave,
}) => {
  const [input, setInput] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  useEffect(() => {
    if (isOpen) {
      setInput('');
      setTagsInput('');
    }
  }, [isOpen]);

  const handleSave = () => {
    const tags = tagsInput
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);
    onSave(input, tags);
  };

  return (
    <Modal isOpen={isOpen} toggle={toggle}>
      <ModalHeader toggle={toggle}>
        Add Simple Example
      </ModalHeader>
      <ModalBody>
        <Form>
          <FormGroup>
            <Label for="input">Input *</Label>
            <Input
              type="textarea"
              id="input"
              rows={6}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter the example input..."
            />
          </FormGroup>
          <FormGroup>
            <Label for="tags">Tags</Label>
            <Input
              type="text"
              id="tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="Comma-separated tags (e.g., tag1, tag2, tag3)"
            />
            <small className="text-muted">Enter tags separated by commas</small>
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button color="secondary" onClick={toggle}>
          Cancel
        </Button>
        <Button color="primary" onClick={handleSave} disabled={!input.trim()}>
          Add Example
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default AddExampleModal;

