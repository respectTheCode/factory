import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

// @ts-expect-error The poller is a deliberately dependency-light JavaScript entrypoint.
import { pollPilot } from "../../scripts/poll-pilot.mjs";

const RELEASE_SHA = "a".repeat(40);
const RUNNING_SHA = "b".repeat(40);
const WEBHOOK_URL =
  "http://192.168.5.50:3000/api/deploy/compose/test-refresh-token";

function fixtureDirectory(): string {
  return mkdtempSync(join(tmpdir(), "factory-pilot-poller-"));
}

function requestFixture(
  events: string[],
  options: {
    releaseSha?: string;
    runningSha?: string;
    webhookStatus?: number;
  } = {},
) {
  const releaseSha = options.releaseSha ?? RELEASE_SHA;
  const runningSha = options.runningSha ?? RUNNING_SHA;
  return async (url: URL, requestOptions: Record<string, unknown> = {}) => {
    const serialized = url.toString();
    if (serialized.includes("api.github.com/repos/")) {
      events.push("github");
      return {
        status: 200,
        body: JSON.stringify({ object: { sha: releaseSha } }),
      };
    }
    if (serialized === "http://192.168.5.50:3101/version") {
      events.push("pilot");
      return {
        status: 200,
        body: JSON.stringify({ environment: "pilot", revision: runningSha }),
      };
    }
    if (requestOptions.method === "POST") {
      events.push("webhook");
      return { status: options.webhookStatus ?? 202, body: "{}" };
    }
    throw new Error(`Unexpected fixture request: ${serialized}`);
  };
}

describe("pilot release poller backup gate", () => {
  test("does not run a backup for a matching release", async () => {
    const directory = fixtureDirectory();
    const events: string[] = [];
    let backupCalls = 0;
    try {
      const result = await pollPilot({
        cwd: directory,
        environment: {},
        request: requestFixture(events, {
          releaseSha: RELEASE_SHA,
          runningSha: RELEASE_SHA,
        }),
        backup: async () => {
          backupCalls += 1;
          throw new Error("backup must not run for a no-op");
        },
      });

      expect(result).toEqual({ status: "no-op", sha: RELEASE_SHA });
      expect(backupCalls).toBe(0);
      expect(events).toEqual(["github", "pilot"]);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("backs up a changed release before requesting the webhook", async () => {
    const directory = fixtureDirectory();
    const webhookFile = join(directory, "pilot-webhook");
    writeFileSync(webhookFile, `${WEBHOOK_URL}\n`, { mode: 0o600 });
    const events: string[] = [];
    try {
      const result = await pollPilot({
        cwd: directory,
        environment: { FACTORY_PILOT_WEBHOOK_FILE: webhookFile },
        request: requestFixture(events),
        backup: async ({ releaseSha }: { releaseSha: string }) => {
          events.push(`backup:${releaseSha}`);
        },
      });

      expect(result).toEqual({ status: "requested", sha: RELEASE_SHA });
      expect(events).toEqual([
        "github",
        "pilot",
        `backup:${RELEASE_SHA}`,
        "webhook",
      ]);
      expect(
        JSON.parse(
          readFileSync(
            join(directory, ".factory-pilot-last-request.json"),
            "utf8",
          ),
        ),
      ).toMatchObject({
        sha: RELEASE_SHA,
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("fails closed on backup failure and never calls the webhook", async () => {
    const directory = fixtureDirectory();
    const webhookFile = join(directory, "pilot-webhook");
    writeFileSync(webhookFile, `${WEBHOOK_URL}\n`, { mode: 0o600 });
    const events: string[] = [];
    try {
      await expect(
        pollPilot({
          cwd: directory,
          environment: { FACTORY_PILOT_WEBHOOK_FILE: webhookFile },
          request: requestFixture(events),
          backup: async () => {
            events.push("backup");
            throw new Error("snapshot unavailable");
          },
        }),
      ).rejects.toThrow("snapshot unavailable");
      expect(events).toEqual(["github", "pilot", "backup"]);
      expect(() =>
        readFileSync(join(directory, ".factory-pilot-last-request.json")),
      ).toThrow();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("suppresses a duplicate requested release without taking another backup", async () => {
    const directory = fixtureDirectory();
    const webhookFile = join(directory, "pilot-webhook");
    writeFileSync(webhookFile, `${WEBHOOK_URL}\n`, { mode: 0o600 });
    writeFileSync(
      join(directory, ".factory-pilot-last-request.json"),
      JSON.stringify({
        sha: RELEASE_SHA,
        requestedAt: "2026-09-18T00:00:00.000Z",
      }),
      { mode: 0o600 },
    );
    const events: string[] = [];
    let backupCalls = 0;
    try {
      const result = await pollPilot({
        cwd: directory,
        environment: { FACTORY_PILOT_WEBHOOK_FILE: webhookFile },
        request: requestFixture(events),
        backup: async () => {
          backupCalls += 1;
        },
      });

      expect(result).toEqual({ status: "already_requested", sha: RELEASE_SHA });
      expect(backupCalls).toBe(0);
      expect(events).toEqual(["github", "pilot"]);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
