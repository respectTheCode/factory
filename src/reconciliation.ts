import { parseGitHubPullRequestUrl } from "./github";

/**
 * Pure matching and reconciliation rules for external coding-session
 * observations.  The module deliberately knows nothing about T3's wire
 * format or Factory persistence; callers provide normalized facts and retain
 * authority over how a finding is stored or acted on.
 */

export type ReconciliationSessionState =
  | "idle"
  | "starting"
  | "ready"
  | "running"
  | "interrupted"
  | "stopped"
  | "error";

export type ReconciliationTurnState =
  | "running"
  | "interrupted"
  | "completed"
  | "error";

export type ReconciliationWorkState =
  | "backlog"
  | "planned"
  | "active"
  | "awaiting_verification"
  | "blocked"
  | "completed";

export type ReconciliationSession = {
  provider: "t3";
  externalThreadId: string;
  externalProjectId: string;
  projectId: string;
  repositoryIdentity?: string;
  workspaceRoot?: string;
  branch?: string;
  linkedPullRequestUrl?: string;
  latestSessionState?: ReconciliationSessionState;
  latestTurnState?: ReconciliationTurnState;
  latestTurnCompletedAt?: Date;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
  observedAt: Date;
  sourceUpdatedAt: Date;
  sourceStream?: string;
};

export type ReconciliationTarget = {
  projectId: string;
  taskId: string;
  taskName: string;
  subtaskId?: string;
  subtaskName?: string;
  branchName?: string;
  pullRequestUrl?: string;
  repositoryIdentity?: string;
  workspaceRoot?: string;
  workState: ReconciliationWorkState;
  latestReportAt?: Date;
};

export type ReconciliationMatchBasis =
  | "pull_request"
  | "repository_branch"
  | "workspace_branch";

export type ReconciliationMatch =
  | {
      status: "matched";
      basis: ReconciliationMatchBasis;
      candidate: ReconciliationTarget;
      candidates: ReconciliationTarget[];
    }
  | {
      status: "ambiguous";
      basis: ReconciliationMatchBasis;
      candidates: ReconciliationTarget[];
    }
  | {
      status: "unmatched";
      candidates: [];
    };

function canonicalRepositoryIdentity(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  if (!trimmed.includes("://")) {
    const scpStyle = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(trimmed);
    if (scpStyle?.[1] && scpStyle[2]) {
      return `${scpStyle[1].toLowerCase().replace(/^www\./, "")}/${scpStyle[2]
        .replace(/^\/+|\/+$/g, "")
        .replace(/\.git$/i, "")
        .toLowerCase()}`;
    }
  }

  try {
    const parsed = new URL(trimmed);
    return `${parsed.hostname.toLowerCase().replace(/^www\./, "")}${
      parsed.port ? `:${parsed.port}` : ""
    }/${parsed.pathname
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/i, "")
      .toLowerCase()}`;
  } catch {
    return trimmed
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/i, "")
      .toLowerCase();
  }
}

function canonicalPullRequestUrl(
  value: string | undefined,
): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const reference = parseGitHubPullRequestUrl(value);
    return `https://github.com/${reference.owner.toLowerCase()}/${reference.repo.toLowerCase()}/pull/${reference.number}`;
  } catch {
    return undefined;
  }
}

function same(value: string | undefined, other: string | undefined): boolean {
  return value !== undefined && other !== undefined && value === other;
}

function sameRepository(
  value: string | undefined,
  other: string | undefined,
): boolean {
  const canonical = canonicalRepositoryIdentity(value);
  return (
    canonical !== undefined && canonical === canonicalRepositoryIdentity(other)
  );
}

function finishMatch(
  basis: ReconciliationMatchBasis,
  candidates: ReconciliationTarget[],
): ReconciliationMatch {
  if (candidates.length === 1) {
    const candidate = candidates[0];
    if (!candidate) throw new Error("Reconciliation match lost its candidate.");
    return { basis, candidate, candidates, status: "matched" };
  }
  return { basis, candidates, status: "ambiguous" };
}

/**
 * Match only on deterministic identifiers.  A non-empty result at one
 * priority level is terminal: an ambiguous PR or branch is never silently
 * rescued by a weaker title/path heuristic.
 */
export function matchReconciliationTarget(
  session: ReconciliationSession,
  targets: ReconciliationTarget[],
): ReconciliationMatch {
  const pullRequestMatches = targets.filter((target) =>
    same(
      canonicalPullRequestUrl(session.linkedPullRequestUrl),
      canonicalPullRequestUrl(target.pullRequestUrl),
    ),
  );
  if (pullRequestMatches.length > 0) {
    return finishMatch("pull_request", pullRequestMatches);
  }

  const repositoryMatches = targets.filter(
    (target) =>
      sameRepository(session.repositoryIdentity, target.repositoryIdentity) &&
      same(session.branch, target.branchName),
  );
  if (repositoryMatches.length > 0) {
    return finishMatch("repository_branch", repositoryMatches);
  }

  const workspaceMatches = targets.filter(
    (target) =>
      same(session.workspaceRoot, target.workspaceRoot) &&
      same(session.branch, target.branchName),
  );
  if (workspaceMatches.length > 0) {
    return finishMatch("workspace_branch", workspaceMatches);
  }

  return { candidates: [], status: "unmatched" };
}

export type ReconciliationLink = {
  provider: "t3";
  externalThreadId: string;
  taskId?: string;
  subtaskId?: string;
};

export type ReconciliationFindingKind =
  | "unlinked_activity"
  | "ambiguous_target"
  | "planned_but_running"
  | "reported_state_stale"
  | "session_needs_attention"
  | "branch_mismatch"
  | "source_unavailable";

export type ReconciliationFindingSeverity = "info" | "attention";

export type ReconciliationFindingDraft = {
  dedupeKey: string;
  kind: ReconciliationFindingKind;
  severity: ReconciliationFindingSeverity;
  projectId: string;
  externalThreadId?: string;
  taskId?: string;
  subtaskId?: string;
  candidateIds: string[];
  observedAt: Date;
  explanation: string;
  suggestedAction: string;
};

export type ReconciliationInput = {
  sessions: ReconciliationSession[];
  targets: ReconciliationTarget[];
  links: ReconciliationLink[];
  now: Date;
  sourceUnavailable?: Array<{
    projectId: string;
    observedAt: Date;
    explanation: string;
  }>;
  recentActivityWindowMs?: number;
};

function linksFor(
  session: ReconciliationSession,
  links: ReconciliationLink[],
): ReconciliationLink[] {
  return links.filter(
    (link) =>
      link.provider === session.provider &&
      link.externalThreadId === session.externalThreadId,
  );
}

function targetForLink(
  link: ReconciliationLink,
  targets: ReconciliationTarget[],
): ReconciliationTarget | undefined {
  return targets.find(
    (target) =>
      target.taskId === link.taskId && target.subtaskId === link.subtaskId,
  );
}

function targetLabel(target: ReconciliationTarget): string {
  return target.subtaskName
    ? `${target.taskName} / ${target.subtaskName}`
    : target.taskName;
}

function isRecentlyActive(
  session: ReconciliationSession,
  now: Date,
  recentActivityWindowMs: number,
): boolean {
  if (
    session.latestSessionState === "running" ||
    session.latestSessionState === "error" ||
    session.latestTurnState === "running" ||
    session.hasPendingApprovals ||
    session.hasPendingUserInput
  ) {
    return true;
  }
  return (
    now.getTime() - session.sourceUpdatedAt.getTime() <= recentActivityWindowMs
  );
}

function addFinding(
  findings: ReconciliationFindingDraft[],
  finding: ReconciliationFindingDraft,
): void {
  if (findings.some((candidate) => candidate.dedupeKey === finding.dedupeKey)) {
    return;
  }
  findings.push(finding);
}

/**
 * Produce advisory findings from normalized observations and Factory target
 * facts.  This function never changes either input and never emits a
 * completion or verification claim.
 */
export function computeReconciliationFindings({
  links,
  now,
  recentActivityWindowMs = 24 * 60 * 60 * 1000,
  sessions,
  sourceUnavailable = [],
  targets,
}: ReconciliationInput): ReconciliationFindingDraft[] {
  const findings: ReconciliationFindingDraft[] = [];

  for (const source of sourceUnavailable) {
    addFinding(findings, {
      candidateIds: [],
      dedupeKey: `source_unavailable:${source.projectId}`,
      explanation: source.explanation,
      kind: "source_unavailable",
      observedAt: source.observedAt,
      projectId: source.projectId,
      severity: "attention",
      suggestedAction: "Restore T3 read access and refresh observed activity.",
    });
  }

  for (const session of sessions) {
    const sessionLinks = linksFor(session, links);
    const projectTargets = targets.filter(
      (target) => target.projectId === session.projectId,
    );

    if (sessionLinks.length === 0) {
      if (!isRecentlyActive(session, now, recentActivityWindowMs)) continue;
      const match = matchReconciliationTarget(session, projectTargets);
      if (match.status === "ambiguous") {
        addFinding(findings, {
          candidateIds: match.candidates.map(
            (candidate) => candidate.subtaskId ?? candidate.taskId,
          ),
          dedupeKey: `ambiguous_target:${session.provider}:${session.externalThreadId}`,
          explanation: `Observed T3 activity matches multiple Factory targets by ${match.basis.replace("_", " ")}.`,
          externalThreadId: session.externalThreadId,
          kind: "ambiguous_target",
          observedAt: session.sourceUpdatedAt,
          projectId: session.projectId,
          severity: "attention",
          suggestedAction:
            "Choose the intended Factory Task or Subtask explicitly.",
        });
      } else {
        addFinding(findings, {
          candidateIds:
            match.status === "matched"
              ? [match.candidate.subtaskId ?? match.candidate.taskId]
              : [],
          dedupeKey: `unlinked_activity:${session.provider}:${session.externalThreadId}`,
          explanation:
            match.status === "matched"
              ? `Observed T3 activity appears to belong to ${targetLabel(match.candidate)}, but no Factory link exists.`
              : "Recent T3 activity has no deterministic Factory Task or Subtask match.",
          externalThreadId: session.externalThreadId,
          kind: "unlinked_activity",
          observedAt: session.sourceUpdatedAt,
          projectId: session.projectId,
          severity: "attention",
          suggestedAction:
            "Review the branch or pull request, then link the thread explicitly if appropriate.",
        });
      }
      continue;
    }

    for (const link of sessionLinks) {
      const target = targetForLink(link, projectTargets);
      if (!target) {
        addFinding(findings, {
          candidateIds: [],
          dedupeKey: `ambiguous_target:${session.provider}:${session.externalThreadId}`,
          explanation:
            "The linked Factory target no longer exists in this Project.",
          externalThreadId: session.externalThreadId,
          kind: "ambiguous_target",
          observedAt: session.sourceUpdatedAt,
          projectId: session.projectId,
          severity: "attention",
          suggestedAction:
            "Choose an existing Factory Task or Subtask explicitly.",
        });
        continue;
      }

      if (
        target.branchName !== undefined &&
        session.branch !== undefined &&
        target.branchName !== session.branch
      ) {
        addFinding(findings, {
          candidateIds: [target.subtaskId ?? target.taskId],
          dedupeKey: `branch_mismatch:${session.provider}:${session.externalThreadId}:${target.subtaskId ?? target.taskId}`,
          explanation: `The linked T3 session is on ${session.branch}, while the Factory target is assigned ${target.branchName}.`,
          externalThreadId: session.externalThreadId,
          kind: "branch_mismatch",
          observedAt: session.sourceUpdatedAt,
          projectId: session.projectId,
          severity: "attention",
          suggestedAction:
            "Confirm the target or update the Factory branch metadata.",
          ...(target.subtaskId ? { subtaskId: target.subtaskId } : {}),
          taskId: target.taskId,
        });
      }

      const completedTurnIsRecentOrNewerThanReport =
        session.latestTurnState === "completed" &&
        session.latestTurnCompletedAt !== undefined &&
        (now.getTime() - session.latestTurnCompletedAt.getTime() <=
          recentActivityWindowMs ||
          (target.latestReportAt !== undefined &&
            target.latestReportAt.getTime() <
              session.latestTurnCompletedAt.getTime()));
      if (
        (session.latestSessionState === "running" ||
          session.latestTurnState === "running" ||
          completedTurnIsRecentOrNewerThanReport) &&
        (target.workState === "backlog" || target.workState === "planned")
      ) {
        addFinding(findings, {
          candidateIds: [target.subtaskId ?? target.taskId],
          dedupeKey: `planned_but_running:${session.provider}:${session.externalThreadId}:${target.subtaskId ?? target.taskId}`,
          explanation: `T3 shows ${target.workState === "planned" ? "planned" : "backlog"} Factory work with active or newer turn activity.`,
          externalThreadId: session.externalThreadId,
          kind: "planned_but_running",
          observedAt: session.sourceUpdatedAt,
          projectId: session.projectId,
          severity: "info",
          suggestedAction:
            "Review the observed activity and submit an explicit status report if needed.",
          ...(target.subtaskId ? { subtaskId: target.subtaskId } : {}),
          taskId: target.taskId,
        });
      }

      if (
        target.subtaskId &&
        target.latestReportAt &&
        target.latestReportAt.getTime() < session.sourceUpdatedAt.getTime()
      ) {
        addFinding(findings, {
          candidateIds: [target.subtaskId],
          dedupeKey: `reported_state_stale:${session.provider}:${session.externalThreadId}:${target.subtaskId}`,
          explanation:
            "Observed T3 activity is newer than the latest Factory Status Report.",
          externalThreadId: session.externalThreadId,
          kind: "reported_state_stale",
          observedAt: session.sourceUpdatedAt,
          projectId: session.projectId,
          severity: "attention",
          suggestedAction:
            "Review the session and submit a current Status Report.",
          subtaskId: target.subtaskId,
          taskId: target.taskId,
        });
      }

      if (
        session.latestSessionState === "error" ||
        session.latestTurnState === "error" ||
        session.hasPendingApprovals ||
        session.hasPendingUserInput
      ) {
        addFinding(findings, {
          candidateIds: [target.subtaskId ?? target.taskId],
          dedupeKey: `session_needs_attention:${session.provider}:${session.externalThreadId}:${target.subtaskId ?? target.taskId}`,
          explanation:
            session.latestSessionState === "error" ||
            session.latestTurnState === "error"
              ? "T3 reports an error for the linked session."
              : "T3 reports pending approval or user input for the linked session.",
          externalThreadId: session.externalThreadId,
          kind: "session_needs_attention",
          observedAt: session.sourceUpdatedAt,
          projectId: session.projectId,
          severity: "attention",
          suggestedAction:
            "Inspect the T3 session and resolve the pending action.",
          ...(target.subtaskId ? { subtaskId: target.subtaskId } : {}),
          taskId: target.taskId,
        });
      }
    }
  }

  return findings;
}
