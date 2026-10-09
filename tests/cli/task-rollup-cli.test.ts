import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createFactoryApplication } from "../../src/application";

test("CLI resumes Step status without treating it as a Task finish report", async () => {
  const directory = mkdtempSync(join(tmpdir(), "factory-resume-rollup-"));
  try {
    const databasePath = join(directory, "factory.sqlite");
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({ name: "CLI recovery" });
    const task = app.createTask({ projectId: project.id, name: "Held task" });
    const child = app.createSubtask({
      taskId: task.id,
      name: "Delivered child",
    });
    const report = app.reportSubtaskStatus({
      subtaskId: child.id,
      reportedState: "complete",
      reporter: "codex",
      reason: "Review the slice.",
    });
    app.setTaskWorkState({ taskId: task.id, workState: "active" });
    const process = Bun.spawn(
      [
        Bun.which("bun")!,
        "run",
        "src/cli.ts",
        "task",
        "resume-rollup",
        "--task-id",
        task.id,
        "--database",
        databasePath,
        "--json",
      ],
      { cwd: join(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" },
    );
    const [exit, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    expect(stderr).toBe("");
    expect(exit).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      schemaVersion: 1,
      status: { taskState: "active", taskCompleted: false },
    });
    const reopened = createFactoryApplication({ databasePath });
    expect(reopened.getTaskStatus(task.id)).toMatchObject({
      taskState: "active",
      taskCompleted: false,
      subtasks: [
        { effectiveState: "completed", verificationState: "not_required" },
      ],
    });
    expect(reopened.getSubtaskReportHistory(child.id)).toEqual([report]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
