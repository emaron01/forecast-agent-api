"use client";

import { DataReadinessCard } from "../../../../components/dashboard/executive/DataReadinessCard";

export function TrainingReadinessAdminClient(props: {
  quotaPeriodId?: string;
  snapshotOffsetDays?: number;
}) {
  return (
    <DataReadinessCard
      quotaPeriodId={props.quotaPeriodId || ""}
      snapshotOffsetDays={props.snapshotOffsetDays}
      isAdmin={true}
    />
  );
}
