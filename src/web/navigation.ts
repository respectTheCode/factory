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
