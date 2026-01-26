import { useState } from 'react';
import { Metric } from '../common/types/Metric';
import { addOrEditMetric, deleteMetric } from '../components/MetricModal';
import { asArray } from '../common/utils/miscutils';

export function useMetricManagement() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingMetric, setEditingMetric] = useState<Partial<Metric> | undefined>(undefined);

  const openAddModal = () => {
    setEditingIndex(null);
    setEditingMetric(undefined);
    setIsModalOpen(true);
  };

  const openEditModal = (index: number, metric: Partial<Metric>) => {
    setEditingIndex(index);
    setEditingMetric(metric);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingIndex(null);
    setEditingMetric(undefined);
  };

  const handleSave = (
    metric: Partial<Metric>,
    currentMetrics: Metric[] | undefined,
    onUpdate: (updatedMetrics: Metric[]) => void
  ) => {
    const metricsArray = asArray(currentMetrics) as Metric[];
    const updatedMetrics = addOrEditMetric(metric, metricsArray);
    onUpdate(updatedMetrics);
    closeModal();
  };

  const handleDelete = (
    index: number,
    currentMetrics: Metric[] | undefined,
    onUpdate: (updatedMetrics: Metric[]) => void
  ) => {
    const metricsArray = asArray(currentMetrics) as Metric[];
    if (index >= 0 && index < metricsArray.length) {
      const metricToDelete = metricsArray[index];
      const updatedMetrics = deleteMetric(metricToDelete, metricsArray);
      onUpdate(updatedMetrics);
    }
  };

  return {
    isModalOpen,
    editingIndex,
    editingMetric,
    openAddModal,
    openEditModal,
    closeModal,
    handleSave,
    handleDelete,
  };
}


