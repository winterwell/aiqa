

import { Card, CardBody, CardHeader } from "reactstrap";
import { Dataset, Example } from "../common/types";
import WordcloudCard from "./dashboard/WordcloudCard";

export default function DatasetDashboard({ dataset, examples }: { dataset: Dataset, examples: Example[] }) {
  const texts = examples.map((example) => example.input || "HELLO");
  return (
    <div>
       <WordcloudCard texts={texts} title="Input Words" />
    </div>
  );
}
