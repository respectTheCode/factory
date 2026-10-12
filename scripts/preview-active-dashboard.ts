import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { createFactoryApplication } from "../src/application";
import { createFactoryServer } from "../src/server";
import type { GitHubStatusReader } from "../src/github";
import type {
  T3ActivityReader,
  T3ProjectObservation,
  T3ThreadObservation,
  T3ThreadShellObservation,
} from "../src/t3";

const PREVIEW_PORT = 3016;
const PREVIEW_OPERATOR = {
  name: "sample-preview",
  secret: "factory-preview-only",
};

const previewDirectory = mkdtempSync(
  join(tmpdir(), "factory-active-dashboard-preview-"),
);
const databasePath = join(previewDirectory, "factory.sqlite");
const workspaceRoot = join(previewDirectory, "workspaces", "factory-preview");
const secondaryWorkspaceRoot = join(
  previewDirectory,
  "workspaces",
  "release-preview",
);
mkdirSync(workspaceRoot, { recursive: true });
mkdirSync(secondaryWorkspaceRoot, { recursive: true });

const startedAt = new Date();
const startedAtIso = startedAt.toISOString();
const earlierAtIso = new Date(startedAt.getTime() - 60_000).toISOString();
const repositoryIdentity = "github.com/sample/factory-preview";
const primaryT3ProjectId = "sample-preview-factory-project";
const secondaryT3ProjectId = "sample-preview-release-project";
const PREVIEW_STALE_T3 = process.env.PREVIEW_STALE_T3 === "true";

const t3Project: T3ProjectObservation = {
  id: primaryT3ProjectId,
  title: "SAMPLE PREVIEW — Factory Operations",
  workspaceRoot,
  repositoryIdentity: {
    canonicalKey: repositoryIdentity,
    locator: {
      remoteName: "origin",
      remoteUrl: "https://github.com/sample/factory-preview.git",
      source: "git-remote",
    },
  },
  createdAt: earlierAtIso,
  updatedAt: startedAtIso,
};
const secondaryT3Project: T3ProjectObservation = {
  id: secondaryT3ProjectId,
  title: "SAMPLE PREVIEW — Release Tools",
  workspaceRoot: secondaryWorkspaceRoot,
  repositoryIdentity: {
    canonicalKey: repositoryIdentity,
    locator: {
      remoteName: "origin",
      remoteUrl: "https://github.com/sample/factory-preview.git",
      source: "git-remote",
    },
  },
  createdAt: earlierAtIso,
  updatedAt: startedAtIso,
};

const t3Threads: T3ThreadShellObservation[] = [
  makeThread({
    agent: "Codex",
    branch: "preview/active-pair",
    id: "sample-preview-active-codex",
    title: "SAMPLE PREVIEW — Build task card with Codex",
  }),
  makeThread({
    agent: "Claude",
    branch: "preview/active-pair",
    id: "sample-preview-active-claude",
    title: "SAMPLE PREVIEW — Review task card with Claude",
  }),
  makeThread({
    agent: "Codex",
    branch: "preview/unmatched-observation",
    id: "sample-preview-unmatched-thread",
    title: "SAMPLE PREVIEW — Unmatched observed session",
  }),
  makeThread({
    agent: "Codex",
    branch: "preview/planned",
    hasPendingApprovals: true,
    id: "sample-preview-planned-approval",
    title: "SAMPLE PREVIEW — Approval session attached to planned work",
  }),
];

function makeThread({
  agent,
  branch,
  hasPendingApprovals = false,
  id,
  title,
}: {
  agent: string;
  branch: string;
  hasPendingApprovals?: boolean;
  id: string;
  title: string;
}): T3ThreadShellObservation {
  return {
    id,
    projectId: primaryT3ProjectId,
    title,
    branch,
    worktreePath: workspaceRoot,
    createdAt: earlierAtIso,
    updatedAt: startedAtIso,
    latestUserMessageAt: earlierAtIso,
    latestTurn: {
      turnId: `turn-${id}`,
      state: "running",
      requestedAt: earlierAtIso,
      startedAt: earlierAtIso,
    },
    session: {
      status: "running",
      providerName: agent,
      activeTurnId: `turn-${id}`,
      updatedAt: startedAtIso,
    },
    hasPendingApprovals,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    planProgress: {
      step: "Implement sample",
      completedSteps: 1,
      totalSteps: 3,
    },
  };
}

function createT3Reader(): T3ActivityReader {
  let sequence = 0;
  const failedRead = () => ({
    ok: false as const,
    status: "unreachable" as const,
    fetchedAt: new Date().toISOString(),
    error: "Simulated stale T3 source for the local sample preview.",
  });
  const freshSnapshot = () => {
    const fetchedAt = new Date().toISOString();
    sequence += 1;
    return {
      fetchedAt,
      sourceSequence: sequence,
      sourceUpdatedAt: fetchedAt,
      sourceDigest: `sample-preview-shell-${sequence}`,
      projects: [
        { ...t3Project, updatedAt: fetchedAt },
        { ...secondaryT3Project, updatedAt: fetchedAt },
      ],
      threads: t3Threads.map((thread) => ({
        ...thread,
        updatedAt: fetchedAt,
        ...(thread.session
          ? { session: { ...thread.session, updatedAt: fetchedAt } }
          : {}),
      })),
    };
  };
  return {
    async readShell() {
      if (PREVIEW_STALE_T3) return failedRead();
      const snapshot = freshSnapshot();
      return {
        ok: true,
        status: "ok",
        sourceStream: "shell",
        ...snapshot,
      };
    },
    async readThread({ threadId }): Promise<T3ThreadObservation> {
      if (PREVIEW_STALE_T3) return failedRead();
      const snapshot = freshSnapshot();
      const thread = snapshot.threads.find(
        (candidate) => candidate.id === threadId,
      );
      if (!thread) {
        return {
          ok: false,
          status: "invalid_response",
          fetchedAt: new Date().toISOString(),
          error: "Sample preview thread was not found.",
        };
      }
      return {
        ok: true,
        status: "ok",
        sourceStream: "thread",
        fetchedAt: snapshot.fetchedAt,
        sourceSequence: snapshot.sourceSequence,
        sourceUpdatedAt: snapshot.sourceUpdatedAt,
        sourceDigest: `sample-preview-${threadId}`,
        thread: {
          ...thread,
          messages: [],
          activities: [],
          checkpoints: [],
        },
      };
    },
  };
}

const githubStatusReader: GitHubStatusReader = {
  async read(reference) {
    const draft = reference.number === 102;
    const updatedAt = new Date().toISOString();
    return {
      fetchedAt: updatedAt,
      status: "ok",
      pullRequest: {
        number: reference.number,
        url: reference.url,
        title: draft
          ? "SAMPLE PREVIEW — Draft pull request"
          : "SAMPLE PREVIEW — Open pull request",
        baseBranch: "main",
        headBranch: `preview/sample-${reference.number}`,
        headSha: "a".repeat(40),
        state: "open",
        draft,
        mergeable: true,
        updatedAt,
      },
      checkRuns: [],
      checkRunsStatus: "ok",
      workflowRuns: [],
      workflowRunsStatus: "ok",
    };
  },
};

function seedPreviewData() {
  const application = createFactoryApplication({ databasePath });
  try {
    const project = application.createProject({
      name: "SAMPLE PREVIEW — Factory Operations",
      gitOriginUrl: "https://github.com/sample/factory-preview.git",
      t3ProjectId: primaryT3ProjectId,
      workspaceRoot,
    });
    const releaseProject = application.createProject({
      name: "SAMPLE PREVIEW — Release Tools",
      gitOriginUrl: "https://github.com/sample/factory-preview.git",
      t3ProjectId: secondaryT3ProjectId,
      workspaceRoot: secondaryWorkspaceRoot,
    });

    const tasks = {
      activeWithTwoSessions: application.createTask({
        name: "SAMPLE PREVIEW — Active with two contributors",
        projectId: project.id,
        branchName: "preview/active-pair",
        workState: "active",
        owner: "Codex + Claude",
      }),
      activeWithoutSession: application.createTask({
        name: "SAMPLE PREVIEW — Active with no session",
        projectId: project.id,
        branchName: "preview/active-solo",
        workState: "active",
      }),
      sharedSession: application.createTask({
        name: "SAMPLE PREVIEW — Shared session linked to a second task",
        projectId: project.id,
        branchName: "preview/active-pair",
        workState: "active",
      }),
      longTitle: application.createTask({
        name: "SAMPLE PREVIEW — A deliberately long task title that wraps across multiple lines in the active dashboard card",
        projectId: project.id,
        branchName: "preview/long-title",
        workState: "active",
      }),
      humanBlocked: application.createTask({
        name: "SAMPLE PREVIEW — Waiting on a human",
        projectId: project.id,
        branchName: "preview/human-handoff",
      }),
      agentBlocked: application.createTask({
        name: "SAMPLE PREVIEW — Agent blocked on dependency",
        projectId: project.id,
        branchName: "preview/agent-handoff",
      }),
      inReview: application.createTask({
        name: "SAMPLE PREVIEW — Finished report with open PR",
        projectId: project.id,
        branchName: "preview/open-pr",
        pullRequestUrl: "https://github.com/sample/factory-preview/pull/101",
        finishRule: { kind: "pr_merge", requireHumanCheck: false },
      }),
      draftPr: application.createTask({
        name: "SAMPLE PREVIEW — Draft PR",
        projectId: project.id,
        branchName: "preview/draft-pr",
        pullRequestUrl: "https://github.com/sample/factory-preview/pull/102",
        finishRule: { kind: "pr_merge", requireHumanCheck: false },
      }),
      humanCheckReady: application.createTask({
        name: "SAMPLE PREVIEW — Ready for human check",
        projectId: project.id,
        branchName: "preview/human-check",
        finishRule: { kind: "agent_report", requireHumanCheck: true },
        humanCheckText: "Check the sample result in the dashboard.",
      }),
      planned: application.createTask({
        name: "SAMPLE PREVIEW — Planned work",
        projectId: project.id,
        branchName: "preview/planned",
        workState: "planned",
      }),
      recentlyCompleted: application.createTask({
        name: "SAMPLE PREVIEW — Recently completed",
        projectId: project.id,
        branchName: "preview/completed",
      }),
      filteredProject: application.createTask({
        name: "SAMPLE PREVIEW — Second project filter row",
        projectId: releaseProject.id,
        branchName: "preview/release-filter",
        workState: "active",
      }),
      plannedRevealTwo: application.createTask({
        name: "SAMPLE PREVIEW — Planned reveal row two",
        projectId: project.id,
        workState: "planned",
      }),
      plannedRevealThree: application.createTask({
        name: "SAMPLE PREVIEW — Planned reveal row three",
        projectId: project.id,
        workState: "planned",
      }),
      plannedRevealFour: application.createTask({
        name: "SAMPLE PREVIEW — Planned reveal row four",
        projectId: project.id,
        workState: "planned",
      }),
      plannedRevealFive: application.createTask({
        name: "SAMPLE PREVIEW — Planned reveal row five",
        projectId: project.id,
        workState: "planned",
      }),
      plannedRevealSix: application.createTask({
        name: "SAMPLE PREVIEW — Planned reveal row six",
        projectId: project.id,
        workState: "planned",
      }),
      manualHold: application.createTask({
        name: "SAMPLE PREVIEW — Manual hold",
        projectId: project.id,
        branchName: "preview/manual-hold",
        workState: "active",
      }),
    };

    reportTask(application, tasks.activeWithTwoSessions.id, "in_progress", {
      reporter: "Codex",
      summary: "Two sample contributors are working on this task.",
    });
    reportTask(application, tasks.activeWithoutSession.id, "in_progress", {
      reporter: "Luna",
      summary: "Active work without a linked session.",
    });
    reportTask(application, tasks.sharedSession.id, "in_progress", {
      reporter: "Codex",
      summary: "This task shares one sample T3 session with another task.",
    });
    reportTask(application, tasks.longTitle.id, "in_progress", {
      reporter: "Luna",
      summary: "Use this card to review multi-line task titles.",
    });
    const steps = [
      application.createSubtask({
        name: "SAMPLE PREVIEW — Completed Step",
        taskId: tasks.activeWithTwoSessions.id,
      }),
      application.createSubtask({
        name: "SAMPLE PREVIEW — Active Step",
        taskId: tasks.activeWithTwoSessions.id,
      }),
      application.createSubtask({
        name: "SAMPLE PREVIEW — Won't do Step",
        taskId: tasks.activeWithTwoSessions.id,
      }),
    ];
    application.reportSubtaskStatus({
      subtaskId: steps[0]!.id,
      reportedState: "complete",
      reporter: "Codex",
      evidence: "Completed for the local sample preview.",
    });
    application.reportSubtaskStatus({
      subtaskId: steps[1]!.id,
      reportedState: "in_progress",
      reporter: "Claude",
      evidence: "In progress for the local sample preview.",
    });
    application.reportSubtaskStatus({
      subtaskId: steps[2]!.id,
      reportedState: "blocked",
      reporter: "Codex",
      reason: "Omitted from the sample task rollup.",
    });
    application.archiveSubtask(steps[2]!.id, "wont_do");
    application.setTaskWorkState({
      taskId: tasks.manualHold.id,
      workState: "blocked",
      reason: "Paused by an explicit sample operator hold.",
    });
    reportTask(application, tasks.humanBlocked.id, "blocked", {
      reporter: "Codex",
      reason: "Waiting for a product decision in this sample.",
      handoff: {
        nextOwner: "Sample operator",
        nextOwnerKind: "human",
        nextAction: "Choose which sample dashboard card to review first.",
      },
    });
    reportTask(application, tasks.agentBlocked.id, "blocked", {
      reporter: "Luna",
      reason: "A sample dependency needs another agent pass.",
      handoff: {
        nextOwner: "Codex",
        nextOwnerKind: "agent",
        nextAction: "Resolve the sample dependency and report progress.",
      },
    });
    reportTask(application, tasks.inReview.id, "finished", {
      reporter: "Codex",
      summary: "Sample implementation is ready; its pull request remains open.",
    });
    reportTask(application, tasks.draftPr.id, "finished", {
      reporter: "Codex",
      summary: "Sample draft pull request is open for discussion.",
    });
    reportTask(application, tasks.humanCheckReady.id, "finished", {
      reporter: "Luna",
      summary: "Sample work is ready for the requested human check.",
    });
    reportTask(application, tasks.filteredProject.id, "in_progress", {
      reporter: "Codex",
      summary: "This row belongs to the second sample project.",
    });
    application.markTaskDone({
      taskId: tasks.recentlyCompleted.id,
      actor: "Sample operator",
      reason: "Completed to demonstrate a recent completion.",
    });
    application.archiveTask(tasks.recentlyCompleted.id, "released");

    const observations = [
      makeSessionObservation({
        agent: "Codex",
        branch: "preview/active-pair",
        externalThreadId: "sample-preview-active-codex",
        projectId: project.id,
      }),
      makeSessionObservation({
        agent: "Claude",
        branch: "preview/active-pair",
        externalThreadId: "sample-preview-active-claude",
        projectId: project.id,
      }),
      makeSessionObservation({
        agent: "Codex",
        branch: "preview/unmatched-observation",
        externalThreadId: "sample-preview-unmatched-thread",
        projectId: project.id,
      }),
      makeSessionObservation({
        agent: "Codex",
        branch: "preview/planned",
        externalThreadId: "sample-preview-planned-approval",
        hasPendingApprovals: true,
        projectId: project.id,
      }),
    ];
    application.refreshT3Observations({ observations });
    application.linkT3Thread({
      observation: observations[0]!,
      taskId: tasks.activeWithTwoSessions.id,
    });
    application.linkT3Thread({
      observation: observations[0]!,
      taskId: tasks.sharedSession.id,
    });
    application.linkT3Thread({
      observation: observations[1]!,
      taskId: tasks.activeWithTwoSessions.id,
    });
    application.linkT3Thread({
      observation: observations[3]!,
      taskId: tasks.planned.id,
    });
    if (PREVIEW_STALE_T3) {
      const staleAt = new Date();
      application.refreshT3Observations({
        observations: [],
        refreshedProjects: [
          {
            projectId: project.id,
            sourceId: "legacy",
            machineId: "legacy",
            sourceSequence: 2,
            sourceStream: "shell",
            observedAt: staleAt,
            sourceUpdatedAt: staleAt,
          },
        ],
      });
    }

    return { project, releaseProject, tasks };
  } finally {
    application.close();
  }
}

function makeSessionObservation({
  agent,
  branch,
  externalThreadId,
  hasPendingApprovals = false,
  projectId,
}: {
  agent: string;
  branch: string;
  externalThreadId: string;
  hasPendingApprovals?: boolean;
  projectId: string;
}) {
  return {
    agent,
    branch,
    externalProjectId: primaryT3ProjectId,
    externalThreadId,
    hasPendingApprovals,
    hasPendingUserInput: false,
    latestSessionState: "running" as const,
    latestTurnState: "running" as const,
    machineId: "legacy",
    observedAt: new Date(),
    projectId,
    provider: "t3" as const,
    repositoryIdentity,
    sourceDigest: `sample-preview-${externalThreadId}`,
    sourceId: "legacy",
    sourceSequence: 1,
    sourceStream: "shell",
    sourceUpdatedAt: new Date(),
    title: `SAMPLE PREVIEW — ${agent} contributor session`,
    worktreePath: workspaceRoot,
    workspaceRoot,
  };
}

function reportTask(
  application: ReturnType<typeof createFactoryApplication>,
  taskId: string,
  reportedState: "blocked" | "finished" | "in_progress",
  details: {
    reporter: string;
    summary?: string;
    reason?: string;
    handoff?: {
      nextOwner: string;
      nextOwnerKind: "human" | "agent" | "unknown";
      nextAction: string;
    };
  },
) {
  const current = application.getTaskStatus(taskId);
  application.reportTaskStatus({
    taskId,
    workflowEpoch: current.workflowEpoch,
    reportedState,
    ...details,
  });
}

function printFixture({
  project,
  releaseProject,
  tasks,
}: ReturnType<typeof seedPreviewData>) {
  console.log("=== FACTORY SAMPLE PREVIEW — disposable /tmp data ===");
  console.log(`Main project: ${project.id} — ${project.name}`);
  console.log(`Filter project: ${releaseProject.id} — ${releaseProject.name}`);
  console.log("Sample task IDs:");
  for (const [label, task] of Object.entries(tasks)) {
    console.log(`  ${task.simpleId} (${task.id}) [${label}] ${task.name}`);
  }
  console.log("Unmatched T3 thread: sample-preview-unmatched-thread");
  console.log(
    "Shared session sample-preview-active-codex links the active pair task and shared-session task.",
  );
  console.log(
    "Planned task approval session: sample-preview-planned-approval.",
  );
  console.log(
    `T3 fixture mode: ${PREVIEW_STALE_T3 ? "simulated unavailable (PREVIEW_STALE_T3=true)" : "fresh local fake data"}`,
  );
  console.log(`Local login name: ${PREVIEW_OPERATOR.name}`);
  console.log(`Local login secret: ${PREVIEW_OPERATOR.secret}`);
  console.log("Press Ctrl-C to stop and delete the temporary database.");
}

let server: ReturnType<typeof createFactoryServer> | undefined;
let shuttingDown = false;

try {
  const fixture = seedPreviewData();
  server = createFactoryServer({
    databasePath,
    hostname: "127.0.0.1",
    operator: PREVIEW_OPERATOR,
    port: PREVIEW_PORT,
    t3ActivityReader: createT3Reader(),
    githubStatusReader,
    pullRequestReconciliationIntervalMs: 60 * 60_000,
  });
  printFixture(fixture);
  console.log(`Dashboard: ${server.url}`);
  const health = await fetch(new URL("/healthz", server.url));
  if (!health.ok)
    throw new Error(`Local health check failed: ${health.status}`);
  console.log(
    `HTTP health check: ${health.status} ${JSON.stringify(await health.json())}`,
  );

  await new Promise<void>((resolve) => {
    const stop = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`Stopping sample preview after ${signal}.`);
      try {
        await server?.stop();
      } finally {
        rmSync(previewDirectory, { force: true, recursive: true });
        resolve();
      }
    };
    process.once("SIGINT", () => void stop("SIGINT"));
    process.once("SIGTERM", () => void stop("SIGTERM"));
  });
} catch (error) {
  if (server) await server.stop();
  rmSync(previewDirectory, { force: true, recursive: true });
  throw error;
}
