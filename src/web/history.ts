export type HistoryReportAttribution = {
  machineId?: string;
  reporter: string;
};

export function formatHistoryReportAttribution(
  report: HistoryReportAttribution,
): string {
  const reporter = report.reporter.trim();
  const machineId = report.machineId?.trim();
  return machineId ? `${reporter} · ${machineId}` : reporter;
}
