import React, { useState, useEffect } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter, Form, FormGroup, Button, Label, Input } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { Metric } from '../common/types/Metric';
import PropInput from './generic/PropInput';
import {useRerender} from 'rerenderer';
import { getDefaultLLMPrompt } from '../common/llmPromptTemplate';
import { listModels } from '../api';
import Model from '../common/types/Model';

interface MetricModalProps {
  isOpen: boolean;
  toggle: () => void;
  onSave: (metric: Partial<Metric>) => void;
  initialMetric?: Partial<Metric>;
  isEditing: boolean;
  organisationId?: string;
}

const MetricModal: React.FC<MetricModalProps> = ({
  isOpen,
  toggle,
  onSave,
  initialMetric,
  isEditing,
  organisationId,
}) => {
  const [metric, setMetric] = useState<Partial<Metric>>(initialMetric || {});
  const {rerender} = useRerender();

  // Fetch models for this organisation
  const { data: models, isLoading: modelsLoading } = useQuery({
    queryKey: ['models', organisationId],
    queryFn: () => listModels(organisationId!),
    enabled: !!organisationId && isOpen,
  });

  // Reset metric state when modal opens or initialMetric changes
  useEffect(() => {
    if (isOpen) {
      setMetric(initialMetric || {});
    }
  }, [isOpen, initialMetric]);

  const handleTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const type = e.target.value as 'javascript' | 'llm' | 'number';
    metric.type = type;
    if (type === 'llm' && !('prompt' in metric && metric.prompt)) {
      (metric as any).prompt = getDefaultLLMPrompt(metric.name || metric.id || 'metric');
      metric.unit = 'fraction';
    }
    rerender();
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const modelId = e.target.value;
    if (!metric.parameters) {
      metric.parameters = {};
    }
    if (modelId === '') {
      // Blank option - remove model parameter
      delete metric.parameters.model;
      delete metric.parameters.modelId;
    } else {
      metric.parameters.model = modelId;
    }
    rerender();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!metric.type || !metric.id) {
      return; // Basic validation - type and id are required
    }
    onSave(metric);
  };

  return (
    <Modal isOpen={isOpen} toggle={toggle}>
      <ModalHeader toggle={toggle}>
        {isEditing ? 'Edit Metric' : 'Add Metric'}
      </ModalHeader>
      <Form onSubmit={handleSubmit}>
        <ModalBody>
          <FormGroup>
            <PropInput
              item={metric}
              prop="name"
              type="text"
              placeholder="e.g., Latency"
              onChange={rerender}
            />
            <PropInput 
              item={metric} 
              prop="id" 
              type="text" 
              placeholder="e.g., latency (this can be short and human-readable)" 
              onChange={rerender} 
            />
          </FormGroup>
          <FormGroup>
            <PropInput
              label="Type"
              required
              item={metric}
              prop="type"
              type="select"
              options={['javascript', 'llm', 'number']}
              onChange={handleTypeChange}
            />
          </FormGroup>
          {metric.type === 'llm' && (
            <>
              <FormGroup>
                <Label>
                  Model {metric.parameters?.model && <span>*</span>}
                </Label>
                <Input
                  type="select"
                  value={metric.parameters?.model || metric.parameters?.modelId || ''}
                  onChange={handleModelChange}
                >
                  <option value="">Blank (local api-key or code)</option>
                  {modelsLoading ? (
                    <option disabled>Loading models...</option>
                  ) : (
                    models?.map((model: Model) => (
                      <option key={model.id} value={model.id}>
                        {model.name} {model.version ? `(${model.version})` : ''} - {model.provider}
                      </option>
                    ))
                  )}
                </Input>
              </FormGroup>
              <FormGroup>
                <PropInput
                  label="Prompt"
                  required
                  item={metric}
                  prop="prompt"
                  type="textarea"
                  rows={12}
                  placeholder="Enter the prompt for LLM evaluation"
                  onChange={rerender}
                />
              </FormGroup>
            </>
          )}
          {metric.type === 'javascript' && (
            <FormGroup>
              <PropInput
                label="Code"
                required
                item={metric}
                prop="code"
                type="textarea"
                rows={5}
                placeholder="Enter JavaScript code for evaluation"
                onChange={rerender}
              />
            </FormGroup>
          )}
          <FormGroup>
            <PropInput
              label="Unit"
              item={metric}
              prop="unit"
              type="text"
              placeholder="e.g., ms, USD, tokens, fraction"
              onChange={rerender}
            />
          </FormGroup>
          <FormGroup>
            <PropInput
              label="Description"
              item={metric}
              prop="description"
              type="text"
              placeholder="Optional description"
              onChange={rerender}
            />
          </FormGroup>
        </ModalBody>
        <ModalFooter>
          <Button color="secondary" onClick={toggle} type="button">
            Cancel
          </Button>
          <Button color="primary" type="submit">
            {isEditing ? 'Save Changes' : 'Add Metric'}
          </Button>
        </ModalFooter>
      </Form>
    </Modal>
  );
};

export default MetricModal;

/** Create a new listMetrics by adding or editing a metric */
export function addOrEditMetric(metric, listMetrics): Metric[] {
  // check if metric is already in listMetrics
  let newListMetrics = [...listMetrics];
  const index = listMetrics.findIndex(m => m.id === metric.id);
  if (index !== -1) {
    newListMetrics[index] = metric;
  } else {
    newListMetrics.push(metric);
  }
  return newListMetrics;
}

/** Create a new listMetrics by deleting a metric */
export function deleteMetric(metric: Metric, listMetrics: Metric[]): Metric[] {
  return listMetrics.filter((m) => m.id !== metric.id);
}