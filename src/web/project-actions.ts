export type ProjectSummary = { id: string; name: string };

export type ProjectActions = {
  createProject: (input: { name: string }) => Promise<unknown>;
  listProjects: () => Promise<ProjectSummary[]>;
};

export async function createProjectAndRefresh({
  actions,
  name,
}: {
  actions: ProjectActions;
  name: string;
}): Promise<ProjectSummary[]> {
  await actions.createProject({ name });
  return actions.listProjects();
}
