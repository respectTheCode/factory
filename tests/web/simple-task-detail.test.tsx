import { describe, expect, test } from "bun:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { FloorAction, FloorTaskCard } from "../../src/web/floor";
import { homeTaskSentence } from "../../src/web/home-model";
import { SimpleTaskDetail } from "../../src/web/simple-task-detail";

type Props = ComponentProps<typeof SimpleTaskDetail>;

function task(overrides: Partial<Props["task"]> = {}): Props["task"] {
  return {
    id: "task-1",
    simpleId: "T-1",
    name: "Prepare the release",
    projectId: "project-1",
    acceptanceCriteria: [],
    subtasks: [],
    trackerLinks: [],
    ...overrides,
  };
}

function taskCard(overrides: Partial<FloorTaskCard> = {}): FloorTaskCard {
  return {
    projectId: "project-1",
    taskId: "task-1",
    taskSimpleId: "T-1",
    taskName: "Prepare the release",
    state: "blocked",
    finish: {
      kind: "agent_report",
      requireHumanCheck: false,
      humanCheckReady: false,
      requiredPrCount: 0,
      mergedPrCount: 0,
      agentReportedFinished: false,
    },
    manualHold: false,
    needsYou: { count: 0, verbs: [] },
    sessions: [],
    sessionsAvailable: true,
    ...overrides,
  };
}

function status(overrides: Partial<NonNullable<Props["status"]>> = {}) {
  return {
    taskRevision: 7,
    taskState: "active",
    taskCompleted: false,
    finishRule: {
      kind: "agent_report" as const,
      requireHumanCheck: false,
      requiredPrCount: 0,
    },
    humanCheckReady: false,
    requiredPullRequests: [],
    subtasks: [],
    ...overrides,
  };
}

function request(
  id: string,
  kind: FloorAction["kind"],
  overrides: Partial<FloorAction> = {},
): FloorAction {
  return {
    id,
    kind,
    label: `Request ${id}`,
    projectId: "project-1",
    taskId: "task-1",
    projectName: "Factory",
    timestamp: "2026-10-15T12:00:00Z",
    ageLabel: "5m",
    ...overrides,
  };
}

const baseProps: Props = {
  task: task(),
  snapshot: null,
  projectName: "Factory",
  requests: [],
  connected: true,
  canMutate: true,
  busy: false,
  onBack: () => {},
  onOpenControls: () => {},
  onOpenTarget: () => {},
  onCheck: async () => {},
  onSendBack: async () => {},
  onLoadHistory: async () => ({ items: [], totalCount: 0 }),
};

function render(props: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(SimpleTaskDetail, { ...baseProps, ...props }),
  );
}

describe("SimpleTaskDetail", () => {
  test("matches Home for agent-owned and user-owned blocked tasks", () => {
    const agentCard = taskCard({
      handoff: {
        nextOwner: "Codex",
        nextOwnerKind: "agent",
        nextAction: "Finish the API work.",
        reporter: "Codex",
        reportedAt: "2026-10-15T12:00:00Z",
        additionalCount: 0,
      },
    });
    const userCard = taskCard({ stateReason: "Waiting for your input." });
    const agentSentence = homeTaskSentence(agentCard, null);
    const userSentence = homeTaskSentence(userCard, null);
    const agentHtml = render({
      card: agentCard,
      status: status({ taskState: "blocked" }),
    });
    const userHtml = render({
      card: userCard,
      status: status({
        taskState: "blocked",
        stateReason: "Waiting for your input.",
      }),
    });

    expect(agentSentence).toBe(
      "Blocked on Codex: Finish the API work. Nothing needed from you.",
    );
    expect(agentHtml).toContain(agentSentence);
    expect(agentHtml).toContain(">Blocked</p>");
    expect(agentHtml).not.toContain("Needs you</p>");
    expect(userHtml).toContain(userSentence);
    expect(userHtml).toContain(">Blocked</p>");
    expect(userHtml).not.toContain("Needs you</p>");

    const queuedUserBlock = render({
      card: userCard,
      requests: [request("unblock", "unblock")],
      status: status({ taskState: "blocked" }),
    });
    expect(queuedUserBlock).toContain(">Needs you</p>");
  });

  test("shows the task's recorded status and check readiness when the queue is empty", () => {
    const waiting = render({
      status: status({
        taskState: "awaiting_verification",
        finishRule: {
          kind: "agent_report",
          requireHumanCheck: true,
          requiredPrCount: 0,
        },
        humanCheckReady: false,
      }),
    });
    const ready = render({
      status: status({
        taskState: "awaiting_verification",
        finishRule: {
          kind: "agent_report",
          requireHumanCheck: true,
          requiredPrCount: 0,
        },
        humanCheckReady: true,
        latestTaskReport: {
          reporter: "Codex",
          summary: "The release is ready.",
          createdAt: "2026-10-15T11:55:00Z",
          reportedState: "finished",
        },
      }),
    });

    expect(waiting).toContain(
      "Factory doesn’t have the finish evidence needed to complete this task yet.",
    );
    expect(waiting).not.toContain("Needs you.");
    expect(ready).toContain("Codex finished. It’s ready for your check.");
    expect(ready).toMatch(/Codex reported[^<]*: The release is ready\./);
    expect(ready).not.toContain("ready.,");
    expect(ready).not.toContain("Needs you.");
  });

  test("keeps Check it available under Also needs you when another request is primary", () => {
    const html = render({
      status: status({
        taskState: "awaiting_verification",
        humanCheckReady: true,
      }),
      task: task({
        pullRequestUrl: "https://github.com/example/factory/pull/18",
      }),
      requests: [
        request("review", "review"),
        request("check", "check", { timestamp: "2026-10-15T12:01:00Z" }),
      ],
    });

    expect(html).toContain("Review PR #18 on GitHub");
    expect(html).toContain("Also needs you");
    expect(html).toContain("Ready for your check.");
    expect(html).toContain(">Check it</button>");
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Check it<\/button>/);
  });

  test("renders one GitHub action for each unmerged required pull request", () => {
    const html = render({
      status: status({
        taskState: "awaiting_verification",
        finishRule: {
          kind: "pr_merge",
          requireHumanCheck: false,
          requiredPrCount: 3,
        },
        requiredPullRequests: [
          {
            pullRequestUrl: "https://github.com/example/factory/pull/21",
            required: true,
          },
          {
            pullRequestUrl: "https://github.com/example/factory/pull/22",
            required: true,
            merge: {
              mergeSha: "merge-22",
              mergedAt: "2026-10-15T10:00:00Z",
              defaultBranch: "main",
            },
          },
          {
            pullRequestUrl: "https://github.com/example/factory/pull/23",
            required: true,
          },
          {
            pullRequestUrl: "https://github.com/example/factory/pull/24",
            required: false,
          },
        ],
      }),
      requests: [request("review", "review")],
    });
    const primaryActions =
      html.match(
        /<div class="simple-task-primary-action">([\s\S]*?)<\/div>/,
      )?.[1] ?? "";

    expect(primaryActions).toContain(
      'href="https://github.com/example/factory/pull/21"',
    );
    expect(primaryActions).toContain(
      'href="https://github.com/example/factory/pull/23"',
    );
    expect(primaryActions).not.toContain(
      'href="https://github.com/example/factory/pull/22"',
    );
    expect(primaryActions).not.toContain(
      'href="https://github.com/example/factory/pull/24"',
    );
    expect(primaryActions).toContain("Review PR #21 on GitHub");
    expect(primaryActions).toContain("Review PR #23 on GitHub");
    expect(primaryActions).not.toContain(">Task controls</button>");
    expect(primaryActions).toContain("opens in a new tab");
  });

  test("keeps released provenance green and shows the observed GitHub draft state", () => {
    const html = render({
      card: taskCard({
        state: "completed",
        finishProvenance: "Marked done by Sample operator",
      }),
      githubStatus: {
        fetchedAt: "2026-10-15T10:20:00Z",
        status: "ok",
        pullRequest: {
          baseBranch: "main",
          draft: true,
          headSha: "head-sha",
          headBranch: "feature/release",
          mergeable: true,
          number: 8,
          state: "open",
          title: "Prepare the release",
          updatedAt: "2026-10-15T10:15:00Z",
          url: "https://github.com/example/factory/pull/8",
        },
        checkRuns: [],
        checkRunsStatus: "not_requested",
        workflowRuns: [],
        workflowRunsStatus: "not_requested",
      },
      status: status({
        taskState: "released",
        taskCompleted: true,
        finishMetadata: {
          reason: "Published after review.",
          completedAt: "2026-10-15T10:00:00Z",
        },
      }),
    });

    expect(html).toContain('class="simple-task-state done"');
    expect(html).toContain(">Released</p>");
    expect(html).toContain("Marked done by Sample operator");
    expect(html).toContain("GitHub pull request is a draft");
    expect(html).toContain("observed");
  });

  test("describes a PR finish rule as waiting for merges, not a routine human check", () => {
    const html = render({
      status: status({
        taskState: "awaiting_verification",
        finishRule: {
          kind: "pr_merge",
          requireHumanCheck: false,
          requiredPrCount: 1,
        },
        requiredPullRequests: [
          {
            pullRequestUrl: "https://github.com/example/factory/pull/18",
            required: true,
          },
        ],
      }),
    });

    expect(html).toContain("Waiting for the required pull requests to merge.");
    expect(html).toContain(
      "Required pull requests merge (0 of 1 required merged).",
    );
    expect(html).not.toContain("ready for your check");
    expect(html).not.toContain("Check it");
    expect(html).not.toContain("A human check is also required.");
  });

  test("keeps unavailable thread actions disabled and explains the offline state", () => {
    const html = render({
      requests: [
        request("thread", "decide", {
          threadId: "thread-1",
          sourceId: "t3-one",
          sessionId: "thread-1",
        }),
      ],
      connected: false,
      canMutate: false,
    });

    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Thread details<\/button>/,
    );
    expect(html).toContain(
      "Factory is offline. Thread details are unavailable until it reconnects.",
    );
    expect(html).not.toContain('href="https://t3');
  });

  test("shows why a ready check is read-only and disables its mutation controls", () => {
    const cases = [
      {
        connected: false,
        canMutate: false,
        reason:
          "Factory is offline. This check can’t be recorded until it reconnects.",
      },
      {
        connected: true,
        canMutate: false,
        reason: "Your signed-in human session can’t record a check right now.",
      },
    ] as const;

    for (const state of cases) {
      const html = render({
        status: status({ humanCheckReady: true }),
        connected: state.connected,
        canMutate: state.canMutate,
      });

      expect(html).toContain(state.reason);
      expect(html).toContain('aria-describedby="simple-check-disabled"');
      expect(html).toMatch(/<input[^>]*disabled=""/);
      expect(html).toMatch(
        /<button[^>]*disabled=""[^>]*type="submit">Mark checked<\/button>/,
      );
      expect(html).toMatch(
        /<button[^>]*disabled=""[^>]*type="button">Send back…<\/button>/,
      );
    }
  });

  test("renders reported Step states read-only and excludes skipped Steps from the denominator", () => {
    const html = render({
      task: task({
        subtasks: [
          { id: "done", simpleId: "ST-1", name: "Write the release note" },
          {
            id: "blocked",
            simpleId: "ST-2",
            name: "Run the rollout",
            archiveState: undefined,
          },
          { id: "open", simpleId: "ST-3", name: "Confirm the dashboard" },
          {
            id: "skipped",
            simpleId: "ST-4",
            name: "Publish a legacy notice",
            archiveState: "wont_do",
          },
        ],
      }),
      status: status({
        taskState: "completed",
        taskCompleted: true,
        subtasks: [
          {
            subtaskId: "done",
            effectiveState: "in_progress",
            verificationState: "accepted",
          },
          {
            subtaskId: "blocked",
            effectiveState: "blocked",
            verificationState: "unreported",
            reportedState: "blocked",
            reason: "Waiting for the change window.",
          },
          {
            subtaskId: "open",
            effectiveState: "in_progress",
            verificationState: "unreported",
            reportedState: "in_progress",
          },
          {
            subtaskId: "skipped",
            effectiveState: "in_progress",
            verificationState: "unreported",
          },
        ],
      }),
    });

    expect(html).toContain("Steps ");
    expect(html).toContain("1 of 3 done");
    expect(html).toContain("Write the release note");
    expect(html).toContain(">Done</span>");
    expect(html).toContain("Blocked: Waiting for the change window.");
    expect(html).toContain("Left open");
    expect(html).toContain("Publish a legacy notice");
    expect(html).toContain(">Skipped</span>");
    expect(html).toContain("Steps don’t decide when a task is done.");
    expect(html).not.toContain("Edit step");
  });

  test("keeps evidence collapsed while retaining finish and tracker records", () => {
    const html = render({
      task: task({
        pullRequestUrl: "https://github.com/example/factory/pull/18",
        screenshots: [
          {
            id: "shot-task",
            caption: "Overview",
            uploadedAt: "2026-10-15T10:00:00Z",
          },
        ],
        acceptanceCriteria: ["The rollout remains observable."],
        trackerLinks: [
          {
            id: "linear-1",
            system: "linear",
            stableId: "FACT-18",
            title: "Rollout observability",
            url: "https://linear.app/example/issue/FACT-18",
          },
        ],
      }),
      status: status({
        finishRule: {
          kind: "pr_merge",
          requireHumanCheck: false,
          requiredPrCount: 1,
        },
        requiredPullRequests: [
          {
            pullRequestUrl: "https://github.com/example/factory/pull/18",
            required: true,
          },
        ],
      }),
    });

    expect(html).toMatch(/<details class="simple-task-evidence">/);
    expect(html).not.toMatch(/<details class="simple-task-evidence" open/);
    expect(html).toContain("<summary>Evidence</summary>");
    expect(html).toContain(
      "Required pull requests merge (0 of 1 required merged).",
    );
    expect(html).toContain("The rollout remains observable.");
    expect(html).toContain("Requirements in Linear, Rollout observability");
  });
});
