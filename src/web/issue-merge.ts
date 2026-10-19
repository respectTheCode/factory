import type { Issue } from "../issues";

export function issueMergeCandidates(issues: Issue[], source: Issue): Issue[] {
  return issues.filter(
    (issue) => issue.id !== source.id && issue.projectId === source.projectId,
  );
}

export function issueMergeConfirmation(source: Issue, target: Issue): string {
  return `Merge ${source.simpleId} (“${source.title}”) into ${target.simpleId} (“${target.title}”)? ${source.simpleId} will be removed. ${target.simpleId} will be kept, with the issue details, links, and activity combined into it.`;
}
