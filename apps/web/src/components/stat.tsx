import type { ReactNode } from 'react';
import { Card } from './ui';

export function StatTile({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <Card className="flex flex-col gap-1 p-5">
      <span className="text-small font-medium text-fg-muted">{label}</span>
      <span className="text-h2 font-semibold tabular-nums text-fg">{value}</span>
      {detail && <span className="text-small text-fg-muted">{detail}</span>}
    </Card>
  );
}
