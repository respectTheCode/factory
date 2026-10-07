import { describe, expect, test } from "bun:test";

import type { GitHubStatusSnapshot } from "../../src/github";
import type {
  ObservedActivityViewModel,
  ObservedThread,
} from "../../src/web/observed-activity";
import {
  buildReviewPacket,
  buildTaskTrackingSummary,
  buildTaskScreenshotEvidence,
  checkStateLabel,
  compareRevisionEvidence,
  compositeSessionId,
  evaluateCheckState,
  evaluateReviewState,
  reviewStateLabel,
  sessionFreshness,
  taskLinkedSessions,
  type TrackingGitHubStatus,
  type TrackingStatus,
  type TrackingTask,
} from "../../src/web/task-tracking";

const now = new Date("2026-10-06T12:00:00.000Z");
const headOne = "a".repeat(40);
const headTwo = "b".repeat(40);
const task: TrackingTask = {
  id: "task-1",
  simpleId: "T-84",
  name: "Collector signing",
  pullRequestUrl: "https://github.com/acme/repo/pull/84",
  acceptanceCriteria: ["Key rotation is revision checked."],
  screenshots: [
    { id: "task-shot", caption: "Task view", testedRevision: headOne },
  ],
  subtasks: [
    {
      id: "sub-1",
      simpleId: "ST-188",
      name: "Add signer interface",
      pullRequestUrl: "https://github.com/acme/repo/pull/188",
      screenshots: [
        { id: "shot-1", caption: "After", testedRevision: headOne },
      ],
    },
    { id: "sub-2", simpleId: "ST-189", name: "Verify rotation" },
  ],
};

function thread(overrides: Partial<ObservedThread> = {}): ObservedThread {
  return {
    association: {
      links: [
        {
          linkId: "link-1",
          target: {
            id: "sub-1",
            kind: "subtask",
            label: "Add signer interface",
          },
        },
      ],
      state: "linked",
    },
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    latestSessionState: "running",
    latestTurnState: "running",
    observedAt: now.toISOString(),
    sourceUpdatedAt: now.toISOString(),
    provider: "t3",
    sourceId: "mac-a",
    machineId: "machine-a",
    threadId: "same-thread",
    title: "Untrusted title that is not used for association",
    ...overrides,
  };
}

function activity(
  threads: ObservedThread[],
  sources?: ObservedActivityViewModel["sources"],
): ObservedActivityViewModel {
  return {
    connection: { state: "connected", observedAt: now.toISOString() },
    counts: {
      ambiguous: 0,
      linked: threads.length,
      needsAttention: 0,
      running: threads.length,
      suggested: 0,
      unmatched: 0,
    },
    findings: [],
    targets: [],
    threads,
    sources: sources ?? [
      {
        connection: { state: "connected", observedAt: now.toISOString() },
        counts: {
          ambiguous: 0,
          linked: 0,
          needsAttention: 0,
          running: 0,
          suggested: 0,
          unmatched: 0,
        },
        machineId: "machine-a",
        sourceId: "mac-a",
        status: "ok",
      },
      {
        connection: { state: "connected", observedAt: now.toISOString() },
        counts: {
          ambiguous: 0,
          linked: 0,
          needsAttention: 0,
          running: 0,
          suggested: 0,
          unmatched: 0,
        },
        machineId: "machine-b",
        sourceId: "mac-b",
        status: "ok",
      },
    ],
  };
}

function snapshot(
  overrides: Partial<TrackingGitHubStatus> = {},
): TrackingGitHubStatus {
  const base: GitHubStatusSnapshot = {
    fetchedAt: now.toISOString(),
    status: "ok",
    pullRequest: {
      baseBranch: "main",
      draft: false,
      headSha: headOne,
      headBranch: "feat/test",
      mergeable: true,
      number: 188,
      state: "open",
      title: "Add signer interface",
      updatedAt: now.toISOString(),
      url: "https://github.com/acme/repo/pull/188",
    },
    checkRunsStatus: "ok",
    checkRuns: [
      {
        id: 1,
        name: "Focused tests",
        status: "completed",
        conclusion: "success",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        url: "https://github.com/acme/repo/actions/runs/1",
      },
    ],
    allCheckRunsStatus: "ok",
    allCheckRuns: [
      {
        id: 1,
        name: "Focused tests",
        status: "completed",
        conclusion: "success",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        url: "https://github.com/acme/repo/actions/runs/1",
      },
    ],
    workflowRunsStatus: "ok",
    workflowRuns: [],
  };
  return { ...base, ...overrides } as TrackingGitHubStatus;
}

describe("task contributor and handoff tracking", () => {
  test("includes explicit task and child links, keeps composite session IDs, and ignores suggestions", () => {
    const taskSession = thread({
      sourceId: "mac-a",
      threadId: "shared",
      association: {
        state: "linked",
        links: [
          {
            linkId: "p",
            target: { id: task.id, kind: "task", label: task.name },
          },
        ],
      },
    });
    const childSession = thread({
      sourceId: "mac-b",
      threadId: "shared",
      association: {
        state: "linked",
        links: [
          {
            linkId: "c",
            target: {
              id: "sub-1",
              kind: "subtask",
              label: "Add signer interface",
            },
          },
        ],
      },
    });
    const suggested = thread({
      sourceId: "mac-a",
      threadId: "suggested",
      association: { state: "suggested", candidateIds: ["sub-1"], links: [] },
    });
    const ambiguous = thread({
      sourceId: "mac-a",
      threadId: "ambiguous",
      association: {
        state: "ambiguous",
        candidateIds: ["sub-1", "sub-2"],
        links: [],
      },
    });
    const wrongTarget = thread({
      sourceId: "mac-a",
      threadId: "wrong",
      association: {
        state: "linked",
        links: [
          {
            linkId: "x",
            target: { id: "other-task", kind: "task", label: task.name },
          },
        ],
      },
    });
    const result = taskLinkedSessions(
      task,
      undefined,
      activity([taskSession, childSession, suggested, ambiguous, wrongTarget]),
      now,
    );

    expect(result.map((item) => item.id).sort()).toEqual([
      "mac-a:shared",
      "mac-b:shared",
    ]);
    expect(compositeSessionId("mac-a", "shared")).not.toBe(
      compositeSessionId("mac-b", "shared"),
    );
  });

  test("includes a child-linked session even when the parent task has no session link", () => {
    const childSession = thread({
      association: {
        state: "linked",
        links: [
          {
            linkId: "c",
            target: { id: "sub-2", kind: "subtask", label: "Verify rotation" },
          },
        ],
      },
    });
    const result = taskLinkedSessions(
      task,
      undefined,
      activity([childSession]),
      now,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.targetLabels).toEqual(["Verify rotation"]);
  });

  test("uses source plus thread to attribute reports and leaves duplicate-thread source omissions ambiguous", () => {
    const left = thread({ sourceId: "mac-a", threadId: "shared" });
    const right = thread({ sourceId: "mac-b", threadId: "shared" });
    const status: TrackingStatus = {
      subtasks: [
        {
          subtaskId: "sub-1",
          reportId: "report-ambiguous",
          reportedState: "complete",
          sessionRef: { provider: "t3", externalThreadId: "shared" },
          reportCreatedAt: now.toISOString(),
        },
      ],
    };
    const sessions = taskLinkedSessions(
      task,
      status,
      activity([left, right]),
      now,
    );
    expect(
      sessions.every((session) => session.latestReport === undefined),
    ).toBe(true);
    expect(
      sessions.every((session) => session.reportAttributionAmbiguous),
    ).toBe(true);

    const sourced: TrackingStatus = {
      subtasks: [
        {
          subtaskId: "sub-1",
          reportId: "report-a",
          reportedState: "complete",
          sessionRef: {
            provider: "t3",
            sourceId: "mac-a",
            externalThreadId: "shared",
          },
          reportCreatedAt: "2026-10-06T11:00:00.000Z",
        },
        {
          subtaskId: "sub-2",
          reportId: "report-a-newer",
          reportedState: "blocked",
          sessionRef: {
            provider: "t3",
            sourceId: "mac-a",
            externalThreadId: "shared",
          },
          reportCreatedAt: "2026-10-06T11:30:00.000Z",
        },
      ],
    };
    const sourcedSessions = taskLinkedSessions(
      task,
      sourced,
      activity([left, right]),
      now,
    );
    expect(
      sourcedSessions.find((session) => session.thread.sourceId === "mac-a")
        ?.latestReport?.reportId,
    ).toBe("report-a-newer");
    expect(
      sourcedSessions.find((session) => session.thread.sourceId === "mac-b")
        ?.latestReport,
    ).toBeUndefined();
  });

  test("keeps disconnected, stale, and future observations neutral and separates activity age from source freshness", () => {
    const disconnected = activity(
      [thread({ hasPendingApprovals: true })],
      [
        {
          connection: { state: "unreachable", observedAt: now.toISOString() },
          counts: {
            ambiguous: 0,
            linked: 0,
            needsAttention: 0,
            running: 0,
            suggested: 0,
            unmatched: 0,
          },
          machineId: "machine-a",
          sourceId: "mac-a",
          status: "unavailable",
          error: "unreachable",
        },
      ],
    );
    const disconnectedSession = taskLinkedSessions(
      task,
      undefined,
      disconnected,
      now,
    )[0];
    expect(disconnectedSession?.freshness).toBe("unavailable");
    expect(disconnectedSession?.humanAttention).toBeNull();
    expect(disconnectedSession?.isRunning).toBe(false);

    expect(
      sessionFreshness(
        activity([
          thread({
            sourceUpdatedAt: "2026-10-06T10:00:00.000Z",
            latestSessionState: "idle",
            latestTurnState: "completed",
          }),
        ]),
        thread({
          sourceUpdatedAt: "2026-10-06T10:00:00.000Z",
          latestSessionState: "idle",
          latestTurnState: "completed",
        }),
        now,
      ),
    ).toBe("fresh");
    const staleSource = activity(
      [thread()],
      [
        {
          connection: {
            state: "connected",
            observedAt: "2026-10-06T11:54:59.000Z",
          },
          counts: {
            ambiguous: 0,
            linked: 0,
            needsAttention: 0,
            running: 0,
            suggested: 0,
            unmatched: 0,
          },
          machineId: "machine-a",
          sourceId: "mac-a",
          status: "ok",
        },
      ],
    );
    expect(
      taskLinkedSessions(task, undefined, staleSource, now)[0]?.freshness,
    ).toBe("stale");
    const futureSource = activity(
      [thread()],
      [
        {
          connection: {
            state: "connected",
            observedAt: "2026-10-06T12:01:00.000Z",
          },
          counts: {
            ambiguous: 0,
            linked: 0,
            needsAttention: 0,
            running: 0,
            suggested: 0,
            unmatched: 0,
          },
          machineId: "machine-a",
          sourceId: "mac-a",
          status: "ok",
        },
      ],
    );
    expect(
      taskLinkedSessions(task, undefined, futureSource, now)[0]?.freshness,
    ).toBe("stale");

    const oldActivity = thread({
      sourceUpdatedAt: "2026-10-06T10:00:00.000Z",
      latestSessionState: "idle",
      latestTurnState: "completed",
    });
    const session = taskLinkedSessions(
      task,
      undefined,
      activity([oldActivity]),
      now,
    )[0];
    expect(session?.freshness).toBe("fresh");
    expect(session?.activityAge).toBe("2h ago");
  });

  test("does not count approval, user-input, or error sessions as working children", () => {
    const approval = thread({ hasPendingApprovals: true });
    const input = thread({ sourceId: "mac-b", hasPendingUserInput: true });
    const errored = thread({
      sourceId: "mac-b",
      threadId: "errored",
      latestTurnState: "error",
    });
    const summary = buildTaskTrackingSummary(
      task,
      undefined,
      activity([approval, input, errored]),
      now,
    );
    expect(summary.activeChildCount).toBe(0);
    expect(
      summary.sessions.find(
        (session) => session.thread.threadId === "same-thread",
      )?.humanAttention,
    ).toBe("approval");
    expect(
      summary.sessions.find((session) => session.thread.threadId === "errored")
        ?.isRunning,
    ).toBe(false);
  });

  test("counts only fresh running child sessions and retains blocked reasons and typed handoffs", () => {
    const status: TrackingStatus = {
      taskState: "blocked",
      stateReason: "Awaiting the signing identity decision.",
      subtasks: [
        {
          subtaskId: "sub-1",
          reportedState: "in_progress",
          effectiveState: "active",
          handoff: {
            nextOwner: "Reviewer",
            nextOwnerKind: "human",
            nextAction: "Choose signing identity",
            waitingOnSubtaskIds: ["sub-2"],
          },
        },
        {
          subtaskId: "sub-2",
          reportedState: "blocked",
          effectiveState: "blocked",
          reason: "Key source is unavailable.",
          handoff: {
            nextOwner: "Agent runner",
            nextOwnerKind: "agent",
            nextAction: "Retry after credentials arrive",
            dependency: "Signing key source",
          },
        },
      ],
    };
    const child = thread({
      association: {
        state: "linked",
        links: [
          {
            linkId: "child",
            target: {
              id: "sub-1",
              kind: "subtask",
              label: "Add signer interface",
            },
          },
        ],
      },
    });
    const summary = buildTaskTrackingSummary(
      task,
      status,
      activity([child]),
      now,
    );
    expect(summary.activeChildCount).toBe(1);
    expect(summary.waitHandoffSubtaskIds).toEqual(["sub-2"]);
    expect(summary.humanHandoffs).toHaveLength(1);
    expect(
      summary.handoffs.map(({ handoff }) => handoff.nextOwnerKind),
    ).toEqual(["human", "agent"]);
    expect(summary.blockedReasons).toContainEqual({
      label: "Task T-84",
      reason: "Awaiting the signing identity decision.",
    });
    expect(summary.blockedReasons).toContainEqual({
      label: "ST-189 · Verify rotation",
      reason: "Key source is unavailable.",
    });
  });
});

describe("exact-head review packet evidence", () => {
  const reportStatus: TrackingStatus = {
    taskState: "awaiting_verification",
    subtasks: [
      {
        subtaskId: "sub-1",
        reportId: "report-1",
        reportCreatedAt: now.toISOString(),
        reportedState: "complete",
        reason: "Implementation is ready.",
        reporter: "Alex Operator",
        machineId: "machine-a",
        sessionRef: {
          provider: "t3",
          sourceId: "mac-a",
          externalThreadId: "same-thread",
        },
        testedRevision: headOne,
        reportEvidence: "Focused test output.",
        verificationState: "awaiting_verification",
      },
    ],
  };

  test("passes only complete exact-revision checks and accepts neutral or skipped conclusions", () => {
    expect(evaluateCheckState(snapshot(), headOne, now)).toBe("passing");
    const skipped = snapshot({
      checkRuns: [
        {
          id: 2,
          name: "Optional check",
          status: "completed",
          conclusion: "skipped",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          url: "https://github.com/acme/repo/checks/2",
        },
      ],
      allCheckRuns: [
        {
          id: 2,
          name: "Optional check",
          status: "completed",
          conclusion: "skipped",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          url: "https://github.com/acme/repo/checks/2",
        },
      ],
    });
    expect(evaluateCheckState(skipped, headOne, now)).toBe("passing");
    const neutral = snapshot({
      checkRuns: [
        {
          id: 3,
          name: "Advisory",
          status: "completed",
          conclusion: "neutral",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          url: "https://github.com/acme/repo/checks/3",
        },
      ],
      allCheckRuns: [
        {
          id: 3,
          name: "Advisory",
          status: "completed",
          conclusion: "neutral",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          url: "https://github.com/acme/repo/checks/3",
        },
      ],
    });
    expect(evaluateCheckState(neutral, headOne, now)).toBe("passing");
    const externalFailure = snapshot({
      allCheckRunsStatus: "ok",
      allCheckRuns: [
        {
          id: 31,
          name: "Third-party security",
          status: "completed",
          conclusion: "failure",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          url: "https://github.com/acme/repo/checks/31",
          appSlug: "security-app",
        },
      ],
    });
    expect(evaluateCheckState(externalFailure, headOne, now)).toBe("failing");
    const workflowFailure = snapshot({
      allCheckRunsStatus: "ok",
      allCheckRuns: [
        {
          id: 32,
          name: "External check",
          status: "completed",
          conclusion: "success",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          url: "https://github.com/acme/repo/checks/32",
        },
      ],
      workflowRuns: [
        {
          id: 33,
          name: "Release build",
          workflowName: "Release build",
          status: "completed",
          conclusion: "failure",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          url: "https://github.com/acme/repo/actions/runs/33",
        },
      ],
    });
    expect(evaluateCheckState(workflowFailure, headOne, now)).toBe("failing");
    expect(
      evaluateCheckState(
        snapshot({
          allCheckRunsStatus: "ok",
          workflowRunsStatus: "unavailable",
        }),
        headOne,
        now,
      ),
    ).toBe("unknown");
    expect(
      evaluateCheckState(
        snapshot({ allCheckRunsStatus: "unavailable" }),
        headOne,
        now,
      ),
    ).toBe("unknown");
    expect(
      evaluateCheckState(
        snapshot({
          allCheckRunsStatus: "ok",
          workflowRunsStatus: "unavailable",
        }),
        headOne,
        now,
      ),
    ).toBe("unknown");
    expect(evaluateCheckState(snapshot(), headOne.slice(0, 7), now)).toBe(
      "unknown",
    );
    expect(
      compareRevisionEvidence(headOne.slice(0, 7), headOne.slice(0, 7)),
    ).toBe("unknown");
    expect(compareRevisionEvidence("same", "same")).toBe("unknown");
    expect(
      evaluateCheckState(
        snapshot({
          pullRequest: { ...snapshot().pullRequest!, headSha: "same" },
        }),
        "same",
        now,
      ),
    ).toBe("unknown");
    expect(
      evaluateCheckState(
        snapshot({ checkRuns: [], allCheckRuns: [], workflowRuns: [] }),
        headOne,
        now,
      ),
    ).toBe("unknown");
    expect(
      evaluateCheckState(
        snapshot({
          allCheckRunsStatus: "not_requested",
          workflowRunsStatus: "ok",
        }),
        headOne,
        now,
      ),
    ).toBe("unknown");
    expect(
      evaluateCheckState(
        snapshot({
          allCheckRunsStatus: "ok",
          workflowRunsStatus: "not_requested",
        }),
        headOne,
        now,
      ),
    ).toBe("unknown");
    expect(
      evaluateCheckState(
        snapshot({
          checkRuns: [
            {
              id: 4,
              name: "Unknown",
              status: "completed",
              createdAt: now.toISOString(),
              updatedAt: now.toISOString(),
              url: "https://github.com/acme/repo/checks/4",
            },
          ],
          allCheckRuns: [
            {
              id: 4,
              name: "Unknown",
              status: "completed",
              createdAt: now.toISOString(),
              updatedAt: now.toISOString(),
              url: "https://github.com/acme/repo/checks/4",
            },
          ],
        }),
        headOne,
        now,
      ),
    ).toBe("unknown");
    expect(
      evaluateCheckState(
        snapshot({
          checkRunsStatus: "unavailable",
          allCheckRunsStatus: "unavailable",
        }),
        headOne,
        now,
      ),
    ).toBe("unknown");
    expect(checkStateLabel("unknown")).toBe("Unknown");
  });

  test("marks old and too-far-future GitHub snapshots stale", () => {
    expect(
      evaluateCheckState(
        snapshot({ fetchedAt: "2026-10-06T11:54:59.000Z" }),
        headOne,
        now,
      ),
    ).toBe("stale");
    expect(
      evaluateCheckState(
        snapshot({ fetchedAt: "2026-10-06T12:01:00.000Z" }),
        headOne,
        now,
      ),
    ).toBe("stale");
    const review = {
      status: "ok" as const,
      headSha: headOne,
      completed: true,
      unresolvedThreads: 0,
      decision: "approved" as const,
      reviewers: ["Reviewer"],
    };
    expect(
      evaluateReviewState(
        review,
        headOne,
        headOne,
        snapshot({ fetchedAt: "2026-10-06T11:54:59.000Z", review }),
        now,
      ),
    ).toBe("stale");
  });

  test("requires exact report, current PR, and review heads; unknown reviews never pass", () => {
    const approved = {
      status: "ok" as const,
      headSha: headOne,
      completed: true,
      unresolvedThreads: 0,
      decision: "approved" as const,
      reviewers: ["Code reviewer"],
    };
    expect(
      evaluateReviewState(
        approved,
        headOne,
        headOne,
        snapshot({ review: approved }),
        now,
      ),
    ).toBe("finished");
    expect(
      evaluateReviewState(
        { ...approved, decision: "commented" },
        headOne,
        headOne,
        snapshot({ review: { ...approved, decision: "commented" } }),
        now,
      ),
    ).toBe("finished");
    expect(
      evaluateReviewState(
        approved,
        headOne,
        headOne.slice(0, 7),
        snapshot({ review: approved }),
        now,
      ),
    ).toBe("untied");
    expect(
      evaluateReviewState(
        { ...approved, headSha: "old-head" },
        headOne,
        headOne,
        snapshot({ review: { ...approved, headSha: "old-head" } }),
        now,
      ),
    ).toBe("stale");
    expect(
      evaluateReviewState(
        { ...approved, unresolvedThreads: undefined },
        headOne,
        headOne,
        snapshot({ review: { ...approved, unresolvedThreads: undefined } }),
        now,
      ),
    ).toBe("unknown");
    expect(
      evaluateReviewState(undefined, headOne, headOne, snapshot(), now),
    ).toBe("unavailable");
    expect(
      evaluateReviewState(
        { ...approved, status: "unavailable", error: "Not configured" },
        headOne,
        headOne,
        snapshot(),
        now,
      ),
    ).toBe("unavailable");
    expect(reviewStateLabel("finished")).toBe("Finished");
  });

  test("uses a subtask PR first, otherwise the parent PR, and compares screenshot revisions independently", () => {
    const packet = buildReviewPacket(
      task,
      reportStatus,
      {
        "task:task-1": snapshot({
          pullRequest: { ...snapshot().pullRequest!, headSha: headTwo },
        }),
        "subtask:sub-1": snapshot(),
      },
      now,
    );
    expect(packet[0]?.headSha).toBe(headOne);
    expect(packet[0]?.revisionMatch).toBe("matches");
    expect(packet[0]?.screenshots[0]?.revisionMatch).toBe("matches");
    expect(packet[0]?.status.reportEvidence).toBe("Focused test output.");

    const noSubtaskPrTask: TrackingTask = {
      ...task,
      subtasks: [{ ...task.subtasks[0]!, pullRequestUrl: undefined }],
    };
    const parentPacket = buildReviewPacket(
      noSubtaskPrTask,
      reportStatus,
      {
        "task:task-1": snapshot({
          pullRequest: { ...snapshot().pullRequest!, headSha: headOne },
        }),
      },
      now,
    );
    expect(parentPacket[0]?.headSha).toBe(headOne);
    expect(parentPacket[0]?.pullRequestUrl).toBe(task.pullRequestUrl);

    const taskShot = buildTaskScreenshotEvidence(noSubtaskPrTask, {
      "task:task-1": snapshot(),
    });
    expect(taskShot[0]?.revisionMatch).toBe("matches");
  });
});
