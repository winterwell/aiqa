import React, { useState, useEffect, useRef } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter, Form, Button } from 'reactstrap';
import { Metric } from '../common/types/Dataset';
import PropInput from './PropInput';

interface MetricModalProps {
  isOpen: boolean;
  toggle: () => void;
  onSave: (metric: Metric) => void;
  initialMetric?: Partial<Metric>;
  isEditing: boolean;
}

const MetricModal: React.FC<MetricModalProps> = ({
  isOpen,
  toggle,
  onSave,
  initialMetric,
  isEditing,
}) => {
  const metricRef = useRef<Partial<Metric>>({
    name: '',
    description: '',
    unit: '',
    type: 'javascript',
    parameters: {},
  });
  const [, rerender] = useState(0);

  useEffect(() => {
    if (isOpen) {
      if (initialMetric) {
        metricRef.current = {
          name: initialMetric.name || '',
          description: initialMetric.description || '',
          unit: initialMetric.unit || '',
          type: initialMetric.type || 'javascript',
          parameters: initialMetric.parameters || {},
        };
      } else {
        metricRef.current = {
          name: '',
          description: '',
          unit: '',
          type: 'javascript',
          parameters: {},
        };
      }
      rerender((n) => n + 1);
    }
  }, [isOpen, initialMetric]);

  const handleSave = () => {
    if (!metricRef.current.name || !metricRef.current.type) {
      alert('Name and Type are required');
      return;
    }
    onSave(metricRef.current as Metric);
  };

  const handleTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const type = e.target.value as 'javascript' | 'llm' | 'number';
    metricRef.current.type = type;
    if (type === 'number') {
      metricRef.current.parameters = {};
    } else if (!metricRef.current.parameters) {
      metricRef.current.parameters = {};
    }
    rerender((n) => n + 1);
  };

  const handleRerender = () => {
    rerender((n) => n + 1);
  };

  const metric = metricRef.current;

  return (
    <Modal isOpen={isOpen} toggle={toggle}>
      <ModalHeader toggle={toggle}>
        {isEditing ? 'Edit Metric' : 'Add Metric'}
      </ModalHeader>
      <ModalBody>
        <Form>
          <PropInput
            label="Name *"
            item={metric}
            prop="name"
            type="text"
            placeholder="e.g., latency"
            onChange={handleRerender}
          />
          <PropInput
            label="Type *"
            item={metric}
            prop="type"
            type="select"
            options={['javascript', 'llm', 'number']}
            onChange={handleTypeChange}
          />
          {metric.type === 'llm' && (
            <PropInput
              label="Prompt *"
              item={metric.parameters || {}}
              prop="prompt"
              type="textarea"
              rows={5}
              placeholder="Enter the prompt for LLM evaluation"
              onChange={handleRerender}
            />
          )}
          {metric.type === 'javascript' && (
            <PropInput
              label="Code *"
              item={metric.parameters || {}}
              prop="code"
              type="textarea"
              rows={5}
              placeholder="Enter JavaScript code for evaluation"
              onChange={handleRerender}
            />
          )}
          <PropInput
            label="Unit"
            item={metric}
            prop="unit"
            type="text"
            placeholder="e.g., ms, USD, tokens"
            onChange={handleRerender}
          />
          <PropInput
            label="Description"
            item={metric}
            prop="description"
            type="text"
            placeholder="Optional description"
            onChange={handleRerender}
          />
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button color="secondary" onClick={toggle}>
          Cancel
        </Button>
        <Button color="primary" onClick={handleSave}>
          {isEditing ? 'Save Changes' : 'Add Metric'}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default MetricModal;

