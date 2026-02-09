import React from 'react';
import { Card, CardBody } from 'reactstrap';

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value }) => {
  return (
    <Card>
      <CardBody>
        <h4 className="text-muted mb-1">{label}</h4>
        <h5>{value}</h5>
      </CardBody>
    </Card>
  );
};

export default MetricCard;

