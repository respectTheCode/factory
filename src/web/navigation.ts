export type DashboardView =
  | { screen: "home" }
  | { screen: "all_tasks" }
  | { screen: "backups" }
  | { screen: "connections" }
  | { screen: "task"; projectId: string; taskId: string }
  | { screen: "project"; projectId: string }
  | { screen: "edit_project"; projectId: string };

export function homeView(): DashboardView {
  return { screen: "home" };
}

export function allTasksView(): DashboardView {
  return { screen: "all_tasks" };
}

export function backupsView(): DashboardView {
  return { screen: "backups" };
}

export function connectionsView(): DashboardView {
  return { screen: "connections" };
}

export function projectView(projectId: string): DashboardView {
  return { projectId, screen: "project" };
}

export function taskView(projectId: string, taskId: string): DashboardView {
  return { projectId, screen: "task", taskId };
}

export function editProjectView(projectId: string): DashboardView {
  return { projectId, screen: "edit_project" };
}

export function dashboardViewFromPath(pathname: string): DashboardView {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return homeView();
  if (segments.length === 1 && segments[0] === "tasks") return allTasksView();
  if (segments.length === 1 && segments[0] === "backups") return backupsView();
  if (segments.length === 1 && segments[0] === "connections")
    return connectionsView();
  if (segments.length === 1 && segments[0] === "ledger") return homeView();
  if (
    segments[0] === "projects" &&
    segments.length === 4 &&
    segments[2] === "tasks"
  ) {
    try {
      const projectId = decodeURIComponent(segments[1] ?? "");
      const taskId = decodeURIComponent(segments[3] ?? "");
      return projectId && taskId ? taskView(projectId, taskId) : homeView();
    } catch {
      return homeView();
    }
  }
  if (
    segments[0] !== "projects" ||
    (segments.length !== 2 && segments.length !== 3)
  ) {
    return homeView();
  }

  let projectId: string;
  try {
    projectId = decodeURIComponent(segments[1] ?? "");
  } catch {
    return homeView();
  }
  if (!projectId) return homeView();
  if (segments.length === 2) return projectView(projectId);
  return segments[2] === "edit" ? editProjectView(projectId) : homeView();
}

export function dashboardPath(view: DashboardView): string {
  if (view.screen === "home") return "/";
  if (view.screen === "all_tasks") return "/tasks";
  if (view.screen === "backups") return "/backups";
  if (view.screen === "connections") return "/connections";
  const projectPath = `/projects/${encodeURIComponent(view.projectId)}`;
  if (view.screen === "task") {
    return `${projectPath}/tasks/${encodeURIComponent(view.taskId)}`;
  }
  return view.screen === "edit_project" ? `${projectPath}/edit` : projectPath;
}
