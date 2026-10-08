import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import {
  createMachineCredentialStore,
  type MachineCredentialStore,
} from "../../src/machine-credential";
import type { FactoryServer } from "../../src/server";
import { createTestServer, loginTestOperator } from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAABAAAAAQBPJcTWAAAADElEQVR4nGP8x8AAAAMCAQBFsWYPAAAAAElFTkSuQmCC",
  "base64",
).toString("base64");

type TRPCBody = {
  error?: { data?: { code?: string }; message?: string };
  result?: { data?: unknown };
};

type TaskStatusSnapshot = {
  taskRevision: number;
  subtasks: Array<{
    subtaskId: string;
    revision: number;
    reportId?: string;
    verificationId?: string;
  }>;
};

type ReviewerFixture = ReturnType<typeof createReviewerFixture>;

async function apiRequest(
  server: Pick<FactoryServer, "url">,
  path: string,
  options: {
    cookie?: string;
    input?: unknown;
    method?: "GET" | "POST";
    token?: string;
  } = {},
): Promise<{ body: TRPCBody; response: Response }> {
  const method = options.method ?? "POST";
  const url = new URL(`/api/${path}`, server.url);
  if (options.input !== undefined) {
    if (method === "GET") {
      url.searchParams.set("input", JSON.stringify(options.input));
    }
  }
  const response = await fetch(url, {
    ...(method === "POST" && options.input !== undefined
      ? { body: JSON.stringify(options.input) }
      : {}),
    headers: {
      ...(method === "POST" && options.input !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    method,
  });
  return { body: (await response.json()) as TRPCBody, response };
}

function createReviewerFixture() {
  const directory = mkdtempSync(join(tmpdir(), "factory-reviewer-auth-"));
  const databasePath = join(directory, "factory.sqlite");
  const application = createFactoryApplication({ databasePath });
  const project = application.createProject({ name: "Reviewer current scope" });
  const task = application.createTask({
    name: "Review release",
    projectId: project.id,
  });
  const subtask = application.createSubtask({
    name: "Check release behavior",
    taskId: task.id,
  });
  const report = application.reportSubtaskStatus({
    reason: "Check the current release build.",
    reporter: "codex",
    reportedState: "complete",
    subtaskId: subtask.id,
  });
  const credentials: MachineCredentialStore = createMachineCredentialStore({
    databasePath,
  });
  const coding = credentials.create({
    machineId: "codex-machine",
    projectIds: [project.id],
  });
  const reviewer = credentials.create({
    allProjects: true,
    machineId: "bitsy-reviewer",
    projectIds: [],
    reviewerName: "Bitsy",
    role: "reviewer",
  });
  application.close();

  // This Project is created after the all-Projects reviewer credential, so the
  // test proves that access is dynamic rather than a copied Project-ID list.
  const futureApplication = createFactoryApplication({ databasePath });
  const futureProject = futureApplication.createProject({
    name: "Reviewer future scope",
  });
  const futureTask = futureApplication.createTask({
    name: "Future review",
    projectId: futureProject.id,
  });
  futureApplication.createSubtask({
    name: "Future check",
    taskId: futureTask.id,
  });
  futureApplication.close();

  const server = createTestServer({
    databasePath,
    hostname: "127.0.0.1",
    port: 0,
  });
  return {
    coding,
    credentials,
    databasePath,
    directory,
    futureProject,
    futureTask,
    project,
    report,
    reviewer,
    server,
    subtask,
    task,
  };
}

async function stopFixture(fixture: ReviewerFixture) {
  await fixture.server.stop();
  fixture.credentials.close();
  rmSync(fixture.directory, { force: true, recursive: true });
}

function data<T>(body: TRPCBody): T {
  return body.result?.data as T;
}

function taskReviewInput(
  status: TaskStatusSnapshot,
  taskId: string,
  options: { reportIdOverride?: string; screenshotIds?: string[] } = {},
) {
  return {
    decision: "accepted",
    expectedTaskRevision: status.taskRevision,
    reportText: "Verified the current release evidence and behavior.",
    reviewedSubtasks: status.subtasks.map((subtask) => ({
      currentReportId: options.reportIdOverride ?? subtask.reportId ?? null,
      currentVerificationId: subtask.verificationId ?? null,
      revision: subtask.revision,
      subtaskId: subtask.subtaskId,
    })),
    screenshotIds: options.screenshotIds ?? [],
    taskId,
  };
}

function screenshotInput(
  target: { taskId: string } | { subtaskId: string },
  requestKey: string,
) {
  return {
    ...target,
    caption: `Reviewer authorization proof ${requestKey}`,
    contentType: "image/png",
    dataBase64: PNG,
    requestKey,
  };
}

async function currentTaskStatus(
  fixture: ReviewerFixture,
  taskId: string,
  token: string,
): Promise<TaskStatusSnapshot> {
  const result = await apiRequest(fixture.server, "tasks.status", {
    input: { taskId },
    method: "GET",
    token,
  });
  expect(result.response.status).toBe(200);
  return data<TaskStatusSnapshot>(result.body);
}

describe("reviewer credential authorization", () => {
  test("preserves reviewer assignments when the human rotates a token", async () => {
    const fixture = createReviewerFixture();
    try {
      const cookie = await loginTestOperator(fixture.server);
      const assigned = await apiRequest(
        fixture.server,
        "subtasks.assignReviewer",
        {
          cookie,
          input: {
            reviewerCredentialId: fixture.reviewer.id,
            subtaskId: fixture.subtask.id,
          },
        },
      );
      expect(assigned.response.status).toBe(200);
      const rotated = await apiRequest(
        fixture.server,
        "agentCredentials.rotate",
        {
          cookie,
          input: { credentialId: fixture.reviewer.id },
        },
      );
      expect(rotated.response.status).toBe(200);
      const result = data<{ credential: { id: string }; token: string }>(
        rotated.body,
      );
      expect(result.credential.id).toBe(fixture.reviewer.id);
      expect(
        fixture.credentials.authenticate(fixture.reviewer.token),
      ).toBeNull();
      const status = await currentTaskStatus(
        fixture,
        fixture.task.id,
        result.token,
      );
      const reviewed = await apiRequest(fixture.server, "subtasks.review", {
        input: {
          decision: "accepted",
          expectedRevision: status.subtasks[0]!.revision,
          reportId: fixture.report.id,
          reportText:
            "Verified the assigned report with the replacement token.",
        },
        token: result.token,
      });
      expect(reviewed.response.status).toBe(200);
    } finally {
      await stopFixture(fixture);
    }
  });

  test("separates coding, reviewer, human-admin, and T3 mutation capabilities", async () => {
    const fixture = createReviewerFixture();
    try {
      const codingReview = await apiRequest(fixture.server, "subtasks.review", {
        input: {
          decision: "accepted",
          expectedRevision: 1,
          reportId: fixture.report.id,
          reportText: "Checked the current build.",
        },
        token: fixture.coding.token,
      });
      expect(codingReview.response.status).toBe(403);
      expect(codingReview.body.error?.data?.code).toBe("FORBIDDEN");

      const codingAssign = await apiRequest(
        fixture.server,
        "subtasks.assignReviewer",
        {
          input: {
            reviewerCredentialId: fixture.reviewer.id,
            subtaskId: fixture.subtask.id,
          },
          token: fixture.coding.token,
        },
      );
      expect(codingAssign.response.status).toBe(401);
      expect(codingAssign.body.error?.data?.code).toBe("UNAUTHORIZED");

      const reviewerProjects = await apiRequest(
        fixture.server,
        "projects.list",
        { method: "GET", token: fixture.reviewer.token },
      );
      expect(reviewerProjects.response.status).toBe(200);
      expect(
        data<Array<{ id: string }>>(reviewerProjects.body).map(({ id }) => id),
      ).toEqual(
        expect.arrayContaining([fixture.project.id, fixture.futureProject.id]),
      );

      for (const taskId of [fixture.task.id, fixture.futureTask.id]) {
        const detail = await apiRequest(fixture.server, "tasks.detail", {
          input: { taskId },
          method: "GET",
          token: fixture.reviewer.token,
        });
        expect(detail.response.status).toBe(200);
        expect(data<{ id: string }>(detail.body).id).toBe(taskId);
      }

      const codingProjects = await apiRequest(fixture.server, "projects.list", {
        method: "GET",
        token: fixture.coding.token,
      });
      expect(
        data<Array<{ id: string }>>(codingProjects.body).map(({ id }) => id),
      ).toEqual([fixture.project.id]);

      const reviewerCreate = await apiRequest(fixture.server, "tasks.create", {
        input: { name: "Reviewer cannot plan", projectId: fixture.project.id },
        token: fixture.reviewer.token,
      });
      expect(reviewerCreate.response.status).toBe(403);
      expect(reviewerCreate.body.error?.data?.code).toBe("FORBIDDEN");

      const reviewerReport = await apiRequest(
        fixture.server,
        "subtasks.report",
        {
          input: {
            reason: "Reviewer cannot submit a coding report.",
            reportedState: "complete",
            reporter: "Bitsy",
            subtaskId: fixture.subtask.id,
          },
          token: fixture.reviewer.token,
        },
      );
      expect(reviewerReport.response.status).toBe(403);
      expect(reviewerReport.body.error?.data?.code).toBe("FORBIDDEN");

      const reviewerBackupAdmin = await apiRequest(
        fixture.server,
        "backups.list",
        { method: "GET", token: fixture.reviewer.token },
      );
      expect(reviewerBackupAdmin.response.status).toBe(401);
      expect(reviewerBackupAdmin.body.error?.data?.code).toBe("UNAUTHORIZED");

      const reviewerIdentityAdmin = await apiRequest(
        fixture.server,
        "reviewers.list",
        { method: "GET", token: fixture.reviewer.token },
      );
      expect(reviewerIdentityAdmin.response.status).toBe(401);
      expect(reviewerIdentityAdmin.body.error?.data?.code).toBe("UNAUTHORIZED");

      const reviewerT3Admin = await apiRequest(
        fixture.server,
        "t3.connections.save",
        {
          input: {
            accessToken: "test-only-t3-secret",
            baseUrl: "http://127.0.0.1:3773",
            label: "Reviewer must not configure T3",
            machineId: "bitsy-reviewer",
          },
          token: fixture.reviewer.token,
        },
      );
      expect(reviewerT3Admin.response.status).toBe(401);
      expect(reviewerT3Admin.body.error?.data?.code).toBe("UNAUTHORIZED");

      const reviewerT3Write = await apiRequest(
        fixture.server,
        "t3.linkThread",
        {
          input: {
            projectId: fixture.project.id,
            taskId: fixture.task.id,
            threadId: "unrelated-thread",
          },
          token: fixture.reviewer.token,
        },
      );
      expect(reviewerT3Write.response.status).toBe(403);
      expect(reviewerT3Write.body.error?.data?.code).toBe("FORBIDDEN");
    } finally {
      await stopFixture(fixture);
    }
  });

  test("requires explicit assignment, scopes screenshot proof, pins reviewed state, and invalidates revoked or rotated credentials", async () => {
    const fixture = createReviewerFixture();
    try {
      const cookie = await loginTestOperator(fixture.server);
      const current = await currentTaskStatus(
        fixture,
        fixture.task.id,
        fixture.reviewer.token,
      );
      const initialSubtask = current.subtasks[0]!;
      const unassignedReview = await apiRequest(
        fixture.server,
        "subtasks.review",
        {
          input: {
            decision: "accepted",
            expectedRevision: initialSubtask.revision,
            reportId: fixture.report.id,
            reportText: "Checked the current build.",
          },
          token: fixture.reviewer.token,
        },
      );
      expect(unassignedReview.response.status).not.toBe(200);
      expect(unassignedReview.body.error?.message).toContain("not assigned");

      const unassignedUpload = await apiRequest(
        fixture.server,
        "screenshots.upload",
        {
          input: screenshotInput(
            { subtaskId: fixture.subtask.id },
            "reviewer-unassigned-upload",
          ),
          token: fixture.reviewer.token,
        },
      );
      expect(unassignedUpload.response.status).toBe(403);
      expect(unassignedUpload.body.error?.data?.code).toBe("FORBIDDEN");

      const foreignProofResponse = await apiRequest(
        fixture.server,
        "screenshots.upload",
        {
          cookie,
          input: screenshotInput(
            { taskId: fixture.futureTask.id },
            "human-foreign-task-proof",
          ),
        },
      );
      expect(foreignProofResponse.response.status).toBe(200);
      const foreignProof = data<{ id: string }>(foreignProofResponse.body);

      const taskProofResponse = await apiRequest(
        fixture.server,
        "screenshots.upload",
        {
          cookie,
          input: screenshotInput(
            { taskId: fixture.task.id },
            "human-current-task-proof",
          ),
        },
      );
      expect(taskProofResponse.response.status).toBe(200);
      const taskProof = data<{ id: string }>(taskProofResponse.body);

      const childAssignment = await apiRequest(
        fixture.server,
        "subtasks.assignReviewer",
        {
          cookie,
          input: {
            reviewerCredentialId: fixture.reviewer.id,
            subtaskId: fixture.subtask.id,
          },
        },
      );
      expect(childAssignment.response.status).toBe(200);

      const unassignedTaskUpload = await apiRequest(
        fixture.server,
        "screenshots.upload",
        {
          input: screenshotInput(
            { taskId: fixture.task.id },
            "reviewer-unassigned-task-proof",
          ),
          token: fixture.reviewer.token,
        },
      );
      expect(unassignedTaskUpload.response.status).toBe(403);
      expect(unassignedTaskUpload.body.error?.message).toContain("assignment");

      const childProofResponse = await apiRequest(
        fixture.server,
        "screenshots.upload",
        {
          input: screenshotInput(
            { subtaskId: fixture.subtask.id },
            "reviewer-child-proof",
          ),
          token: fixture.reviewer.token,
        },
      );
      expect(childProofResponse.response.status).toBe(200);
      const childProof = data<{ id: string }>(childProofResponse.body);
      expect(childProof.id).toBeTruthy();

      const foreignSubtaskReview = await apiRequest(
        fixture.server,
        "subtasks.review",
        {
          input: {
            decision: "accepted",
            expectedRevision: initialSubtask.revision,
            reportId: fixture.report.id,
            reportText: "Attempt to attach proof from another Task.",
            screenshotIds: [foreignProof.id],
          },
          token: fixture.reviewer.token,
        },
      );
      expect(foreignSubtaskReview.response.status).not.toBe(200);
      expect(foreignSubtaskReview.body.error?.message).toContain(
        "outside the reviewed Subtask scope",
      );

      const subtaskReview = await apiRequest(
        fixture.server,
        "subtasks.review",
        {
          input: {
            decision: "accepted",
            expectedRevision: initialSubtask.revision,
            reportId: fixture.report.id,
            reportText: "Verified behavior with Task and Subtask proof.",
            screenshotIds: [taskProof.id, childProof.id],
            source: "human",
            verifier: "Caller-supplied impersonator",
          },
          token: fixture.reviewer.token,
        },
      );
      expect(subtaskReview.response.status).toBe(200);

      const verificationHistory = await apiRequest(
        fixture.server,
        "subtasks.verifications",
        {
          input: { subtaskId: fixture.subtask.id },
          method: "GET",
          token: fixture.reviewer.token,
        },
      );
      expect(verificationHistory.response.status).toBe(200);
      expect(
        data<Array<Record<string, unknown>>>(verificationHistory.body),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            decision: "accepted",
            reportText: "Verified behavior with Task and Subtask proof.",
            screenshotIds: [taskProof.id, childProof.id],
            source: "reviewer",
            verifier: "Bitsy",
          }),
        ]),
      );

      const unassignedTaskReviewStatus = await currentTaskStatus(
        fixture,
        fixture.task.id,
        fixture.reviewer.token,
      );
      const unassignedTaskReview = await apiRequest(
        fixture.server,
        "tasks.review",
        {
          input: taskReviewInput(unassignedTaskReviewStatus, fixture.task.id, {
            screenshotIds: [taskProof.id],
          }),
          token: fixture.reviewer.token,
        },
      );
      expect(unassignedTaskReview.response.status).not.toBe(200);
      expect(unassignedTaskReview.body.error?.message).toContain(
        "not assigned",
      );

      const taskAssignment = await apiRequest(
        fixture.server,
        "tasks.assignReviewer",
        {
          cookie,
          input: {
            reviewerCredentialId: fixture.reviewer.id,
            taskId: fixture.task.id,
          },
        },
      );
      expect(taskAssignment.response.status).toBe(200);

      const assignedTaskProofResponse = await apiRequest(
        fixture.server,
        "screenshots.upload",
        {
          input: screenshotInput(
            { taskId: fixture.task.id },
            "reviewer-assigned-task-proof",
          ),
          token: fixture.reviewer.token,
        },
      );
      expect(assignedTaskProofResponse.response.status).toBe(200);
      expect(
        data<{ uploader: string; uploaderKind: string }>(
          assignedTaskProofResponse.body,
        ),
      ).toMatchObject({
        uploader: "bitsy-reviewer",
        uploaderKind: "machine",
      });
      const assignedTaskProof = data<{ id: string }>(
        assignedTaskProofResponse.body,
      );

      const beforeTaskReview = await currentTaskStatus(
        fixture,
        fixture.task.id,
        fixture.reviewer.token,
      );
      const foreignTaskReview = await apiRequest(
        fixture.server,
        "tasks.review",
        {
          input: taskReviewInput(beforeTaskReview, fixture.task.id, {
            screenshotIds: [foreignProof.id],
          }),
          token: fixture.reviewer.token,
        },
      );
      expect(foreignTaskReview.response.status).not.toBe(200);
      expect(foreignTaskReview.body.error?.message).toContain(
        "outside the reviewed Task",
      );

      const acceptedTaskReview = await apiRequest(
        fixture.server,
        "tasks.review",
        {
          input: taskReviewInput(beforeTaskReview, fixture.task.id, {
            screenshotIds: [taskProof.id, childProof.id, assignedTaskProof.id],
          }),
          token: fixture.reviewer.token,
        },
      );
      expect(acceptedTaskReview.response.status).toBe(200);
      expect(acceptedTaskReview.body.result?.data).toMatchObject({
        decision: "accepted",
        reviewed: true,
      });

      const taskStatusAfterReview = await currentTaskStatus(
        fixture,
        fixture.task.id,
        fixture.reviewer.token,
      );
      const staleTaskRevision = await apiRequest(
        fixture.server,
        "tasks.update",
        {
          input: {
            expectedRevision: taskStatusAfterReview.taskRevision,
            name: "Review release with a changed title",
            taskId: fixture.task.id,
          },
          token: fixture.coding.token,
        },
      );
      expect(staleTaskRevision.response.status).toBe(200);
      const staleTaskReview = await apiRequest(fixture.server, "tasks.review", {
        input: taskReviewInput(taskStatusAfterReview, fixture.task.id),
        token: fixture.reviewer.token,
      });
      expect(staleTaskReview.response.status).toBe(409);
      expect(staleTaskReview.body.error?.data?.code).toBe("CONFLICT");

      const beforeReportChange = await currentTaskStatus(
        fixture,
        fixture.task.id,
        fixture.reviewer.token,
      );
      const staleReportId = beforeReportChange.subtasks[0]?.reportId;
      expect(staleReportId).toBe(fixture.report.id);
      const replacementReport = await apiRequest(
        fixture.server,
        "subtasks.report",
        {
          input: {
            reason: "The coding agent submitted newer evidence.",
            reportedState: "complete",
            reporter: "codex",
            subtaskId: fixture.subtask.id,
          },
          token: fixture.coding.token,
        },
      );
      expect(replacementReport.response.status).toBe(200);

      const currentAfterReportChange = await currentTaskStatus(
        fixture,
        fixture.task.id,
        fixture.reviewer.token,
      );
      const staleReportInput = taskReviewInput(
        currentAfterReportChange,
        fixture.task.id,
        { reportIdOverride: staleReportId },
      );
      const staleReportReview = await apiRequest(
        fixture.server,
        "tasks.review",
        {
          input: staleReportInput,
          token: fixture.reviewer.token,
        },
      );
      expect(staleReportReview.response.status).not.toBe(200);
      expect(staleReportReview.body.error?.message).toContain(
        "changed its current report or verification",
      );

      const currentTaskReview = await apiRequest(
        fixture.server,
        "tasks.review",
        {
          input: taskReviewInput(currentAfterReportChange, fixture.task.id, {
            screenshotIds: [taskProof.id],
          }),
          token: fixture.reviewer.token,
        },
      );
      expect(currentTaskReview.response.status).toBe(200);

      fixture.credentials.revoke(fixture.reviewer.machineId);
      const rotatedReviewer = fixture.credentials.create({
        allProjects: true,
        machineId: fixture.reviewer.machineId,
        projectIds: [],
        reviewerName: "Bitsy",
        role: "reviewer",
      });
      const afterRotation = await currentTaskStatus(
        fixture,
        fixture.task.id,
        rotatedReviewer.token,
      );
      const oldCredentialDecision = await apiRequest(
        fixture.server,
        "subtasks.review",
        {
          input: {
            decision: "rejected",
            expectedRevision: afterRotation.subtasks[0]!.revision,
            reportId: afterRotation.subtasks[0]!.reportId,
            reportText: "Old credential must be rejected.",
          },
          token: fixture.reviewer.token,
        },
      );
      expect(oldCredentialDecision.response.status).not.toBe(200);

      const rotatedCredentialDecision = await apiRequest(
        fixture.server,
        "subtasks.review",
        {
          input: {
            decision: "rejected",
            expectedRevision: afterRotation.subtasks[0]!.revision,
            reportId: afterRotation.subtasks[0]!.reportId,
            reportText: "New credential needs a new assignment.",
          },
          token: rotatedReviewer.token,
        },
      );
      expect(rotatedCredentialDecision.response.status).not.toBe(200);
      expect(rotatedCredentialDecision.body.error?.message).toContain(
        "not assigned",
      );
    } finally {
      await stopFixture(fixture);
    }
  });
});
