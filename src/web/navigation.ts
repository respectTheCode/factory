export type DashboardView =
  | { screen: "home" }
  | { screen: "project"; projectId: string }
  | { screen: "edit_project"; projectId: string };

export function homeView(): DashboardView {
  return { screen: "home" };
}

export function projectView(projectId: string): DashboardView {
  return { projectId, screen: "project" };
}

export function editProjectView(projectId: string): DashboardView {
  return { projectId, screen: "edit_project" };
}

export function dashboardViewFromPath(pathname: string): DashboardView {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return homeView();
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
  const projectPath = `/projects/${encodeURIComponent(view.projectId)}`;
  return view.screen === "edit_project" ? `${projectPath}/edit` : projectPath;
}
