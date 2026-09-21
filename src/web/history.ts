import type {
  ObservedActivityViewModel,
  ObservedThread,
} from "./observed-activity";

export type HistoryReportAttribution = {
  machineId?: string;
  reporter: string;
};

export function historyThreadsForTarget(
  activity: Pick<ObservedActivityViewModel, "threads"> | null,
  targetId: string,
): ObservedThread[] {
  return (
    activity?.threads.filter((thread) =>
      thread.association.links.some((link) => link.target.id === targetId),
    ) ?? []
  );
}

export function formatHistoryReportAttribution(
  report: HistoryReportAttribution,
): string {
  const reporter = report.reporter.trim();
  const machineId = report.machineId?.trim();
  return machineId ? `${reporter} · ${machineId}` : reporter;
}
