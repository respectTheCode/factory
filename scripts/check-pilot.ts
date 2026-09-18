import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";

import {
  createTRPCProxyClient,
  httpLink,
  isTRPCClientError,
} from "@trpc/client";

import { FACTORY_API_VERSION } from "../src/api-version";
import {
  createRemoteFactoryClient,
  resolveFactoryAccessToken,
  validateFactoryUrl,
} from "../src/remote-client";
import type { FactoryRouter } from "../src/server";

const REQUEST_KEY = "st162-pilot-report-v1";
const REPORTER = "pilot-smoke";
const REPORT_EVIDENCE = "ST-162 pilot synthetic report";
const REPORT_REASON =
  "Pilot smoke check completed; awaiting human verification.";
const MACHINE_ID = "pilot-agent";
const MAX_SECRET_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

type DeploymentIdentity = {
  apiVersion: number;
  environment: "development" | "pilot" | "production";
  revision: string;
  schemaVersion: 1;
};

type WsMessage = {
  error?: unknown;
  id?: number | string;
  result?: {
    data?: unknown;
    type?: string;
  };
};

type HttpClient = ReturnType<typeof createTRPCProxyClient<FactoryRouter>>;

function requiredEnvironment(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function readRequiredFile(path: string, label: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`${label} must be an absolute file path.`);
  }

  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    const metadata = fstatSync(descriptor);
    if (
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size > MAX_SECRET_BYTES
    ) {
      throw new Error("invalid file");
    }
    const buffer = Buffer.alloc(MAX_SECRET_BYTES + 1);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (bytesRead !== metadata.size) throw new Error("invalid file");
    const value = buffer.toString("utf8", 0, bytesRead).trim();
    if (!value) throw new Error("invalid file");
    return value;
  } catch {
    throw new Error(
      `${label} must be a readable non-empty file of at most ${MAX_SECRET_BYTES} bytes: ${path}`,
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function endpoint(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${pathname}`;
}

async function request(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function jsonResponse(
  baseUrl: string,
  pathname: string,
  init: RequestInit = {},
): Promise<{ payload: unknown; response: Response }> {
  const response = await request(endpoint(baseUrl, pathname), init);
  if (!response.ok) {
    throw new Error(`${pathname} returned HTTP ${response.status}.`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${pathname} returned invalid JSON.`);
  }
  return { payload, response };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPilotIdentity(value: unknown): value is DeploymentIdentity {
  return (
    isRecord(value) &&
    value.apiVersion === FACTORY_API_VERSION &&
    value.environment === "pilot" &&
    typeof value.revision === "string" &&
    value.schemaVersion === 1
  );
}

function createHttpClient(baseUrl: string, headers?: Record<string, string>) {
  return createTRPCProxyClient<FactoryRouter>({
    links: [
      httpLink({
        ...(headers ? { headers } : {}),
        url: endpoint(baseUrl, "/api"),
      }),
    ],
  });
}

function trpcErrorCode(error: unknown): string | undefined {
  return isTRPCClientError(error) ? error.data?.code : undefined;
}

async function expectUnauthorized(
  operation: () => Promise<unknown>,
  label: string,
): Promise<string> {
  try {
    await operation();
  } catch (error) {
    const code = trpcErrorCode(error);
    if (code === "UNAUTHORIZED") return code;
    throw new Error(`${label} failed with an unexpected error.`);
  }
  throw new Error(`${label} unexpectedly succeeded.`);
}

function createWebSocket(url: string, cookie: string): WebSocket {
  const BunWebSocket = WebSocket as unknown as new (
    url: string,
    options: { headers: Record<string, string> },
  ) => WebSocket;
  return new BunWebSocket(url, { headers: { Cookie: cookie } });
}

async function openWebSocket(url: string, cookie: string): Promise<WebSocket> {
  const socket = createWebSocket(url, cookie);
  await new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    const onOpen = () => {
      clearTimeout(timeout);
      socket.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      clearTimeout(timeout);
      socket.removeEventListener("open", onOpen);
      socket.close();
      reject(new Error("Authenticated WebSocket connection failed."));
    };
    socket.addEventListener("open", onOpen, { once: true });
    socket.addEventListener("error", onError, { once: true });
    timeout = setTimeout(() => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.close();
      reject(
        new Error(
          `Authenticated WebSocket connection timed out after ${REQUEST_TIMEOUT_MS}ms.`,
        ),
      );
    }, REQUEST_TIMEOUT_MS);
  });
  return socket;
}

function waitForWebSocketMessage(
  socket: WebSocket,
  id: number,
  predicate: (message: WsMessage) => boolean = () => true,
): Promise<WsMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for WebSocket response ${id}.`));
    }, REQUEST_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    const onMessage = (event: MessageEvent) => {
      let message: WsMessage;
      try {
        message = JSON.parse(String(event.data)) as WsMessage;
      } catch {
        return;
      }
      if (message.id !== id || !predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onError = () => {
      cleanup();
      reject(new Error(`WebSocket request ${id} failed.`));
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`WebSocket closed while waiting for response ${id}.`));
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

async function sendWebSocketRequest(
  socket: WebSocket,
  id: number,
  method: "query" | "subscription",
  path: string,
  input: unknown,
  predicate?: (message: WsMessage) => boolean,
): Promise<WsMessage> {
  const response = waitForWebSocketMessage(socket, id, predicate);
  socket.send(
    JSON.stringify({
      id,
      method,
      params: { input, path },
    }),
  );
  const message = await response;
  if (message.error) {
    throw new Error(`WebSocket ${path} request was rejected.`);
  }
  return message;
}

async function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 1_000);
    socket.addEventListener(
      "close",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    socket.close();
  });
}

function snapshotProjectId(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.projectDetail)) return undefined;
  return typeof value.projectDetail.id === "string"
    ? value.projectDetail.id
    : undefined;
}

function snapshotHasReportEvidence(
  value: unknown,
  projectId: string,
  subtaskId: string,
): boolean {
  if (
    !isRecord(value) ||
    !isRecord(value.projectDetail) ||
    value.projectDetail.id !== projectId ||
    !Array.isArray(value.projectDetail.tasks)
  ) {
    return false;
  }
  return value.projectDetail.tasks.some(
    (task) =>
      isRecord(task) &&
      Array.isArray(task.subtasks) &&
      task.subtasks.some(
        (subtask) =>
          isRecord(subtask) &&
          subtask.id === subtaskId &&
          subtask.evidence === REPORT_EVIDENCE,
      ),
  );
}

async function loginHuman(
  baseUrl: string,
  operatorSecret: string,
  secure: boolean,
): Promise<string> {
  const response = await request(endpoint(baseUrl, "/session/login"), {
    body: JSON.stringify({ secret: operatorSecret }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok)
    throw new Error(`Human login returned HTTP ${response.status}.`);
  const setCookie = response.headers.get("set-cookie") ?? "";
  if (!setCookie || !/\bfactory_session=[^;]+/i.test(setCookie)) {
    throw new Error("Human login did not return a session cookie.");
  }
  if (secure && !/\bsecure\b/i.test(setCookie)) {
    throw new Error(
      "HTTPS human login did not mark the session cookie Secure.",
    );
  }
  const payload = (await response.json()) as unknown;
  if (!isRecord(payload) || !isRecord(payload.human)) {
    throw new Error("Human login returned an invalid session response.");
  }
  return setCookie.split(";", 1)[0] ?? "";
}

async function main(): Promise<Record<string, unknown>> {
  const configuredUrl = requiredEnvironment("FACTORY_URL");
  const accessTokenPath = requiredEnvironment("FACTORY_ACCESS_TOKEN_FILE");
  const operatorSecretPath = requiredEnvironment("PILOT_OPERATOR_SECRET_FILE");
  const readOnlyValue = Bun.env.PILOT_CHECK_READ_ONLY?.trim() ?? "false";
  if (readOnlyValue !== "true" && readOnlyValue !== "false") {
    throw new Error("PILOT_CHECK_READ_ONLY must be true or false.");
  }
  const readOnly = readOnlyValue === "true";
  const baseUrl = validateFactoryUrl(configuredUrl);
  const machineToken = resolveFactoryAccessToken(accessTokenPath);
  if (!machineToken) {
    throw new Error(
      "FACTORY_ACCESS_TOKEN_FILE must name an absolute readable token file.",
    );
  }
  const operatorSecret = readRequiredFile(
    operatorSecretPath,
    "PILOT_OPERATOR_SECRET_FILE",
  );
  const authorization = { Authorization: `Bearer ${machineToken}` };

  // This must remain the first network request. Never mutate before this guard.
  const versionResult = await jsonResponse(baseUrl, "/version", {
    headers: authorization,
  });
  if (!isPilotIdentity(versionResult.payload)) {
    const environment =
      isRecord(versionResult.payload) &&
      typeof versionResult.payload.environment === "string"
        ? versionResult.payload.environment
        : "unknown";
    throw new Error(
      `Refusing to run: Factory environment is ${environment}, not pilot.`,
    );
  }

  const health = await jsonResponse(baseUrl, "/healthz");
  if (!isRecord(health.payload) || health.payload.status !== "ok") {
    throw new Error("/healthz did not report status ok.");
  }
  const readiness = await jsonResponse(baseUrl, "/readyz");
  if (!isRecord(readiness.payload) || readiness.payload.ready !== true) {
    throw new Error("/readyz did not report ready=true.");
  }
  const deployment = await jsonResponse(baseUrl, "/deployment.json");
  if (
    !isPilotIdentity(deployment.payload) ||
    deployment.response.headers.get("cache-control") !== "no-store"
  ) {
    throw new Error(
      "/deployment.json did not report the cache-safe pilot identity.",
    );
  }

  const staticAssetChecks: Record<string, number> = {};
  for (const pathname of [
    "/",
    "/main.js",
    "/main.css",
    "/service-worker.js",
    "/manifest.webmanifest",
  ]) {
    const response = await request(endpoint(baseUrl, pathname));
    if (!response.ok) {
      throw new Error(`${pathname} returned HTTP ${response.status}.`);
    }
    const bytes = (await response.arrayBuffer()).byteLength;
    if (bytes < 1) throw new Error(`${pathname} returned an empty asset.`);
    staticAssetChecks[pathname] = bytes;
  }

  const remote = createRemoteFactoryClient({
    FACTORY_ACCESS_TOKEN_FILE: accessTokenPath,
    FACTORY_URL: baseUrl,
  });
  const identity = await remote.whoami();
  if (
    !identity.machine ||
    identity.machine.machineId !== MACHINE_ID ||
    identity.machine.projectIds.length === 0
  ) {
    throw new Error(
      "Machine identity is not the seeded pilot-agent credential.",
    );
  }
  const projects = await remote.listProjects();
  const pilotProjects = projects.filter(({ name }) => name === "Factory Pilot");
  if (pilotProjects.length !== 1) {
    throw new Error(
      `Expected one Factory Pilot project; found ${pilotProjects.length}.`,
    );
  }
  const project = pilotProjects[0]!;
  if (!identity.machine.projectIds.includes(project.id)) {
    throw new Error("pilot-agent is not scoped to the Factory Pilot project.");
  }
  const context = await remote.getProjectContext({ projectId: project.id });
  const task = context.tasks.find(({ simpleId }) => simpleId === "T-1");
  if (!task) throw new Error("Seeded Factory Pilot task T-1 was not found.");
  const subtask =
    task.subtasks.find(({ name }) => name === "Submit a pilot report") ??
    task.subtasks[0];
  if (!subtask) throw new Error("Seeded T-1 has no subtask to report.");

  const humanCookie = await loginHuman(
    baseUrl,
    operatorSecret,
    baseUrl.startsWith("https:"),
  );
  const wsUrl = `${baseUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:")}/trpc`;
  let socket = await openWebSocket(wsUrl, humanCookie);
  const subscriptionId = 2;
  try {
    const snapshotResponse = await sendWebSocketRequest(
      socket,
      1,
      "query",
      "projects.snapshot",
      { projectId: project.id },
    );
    const initialProjectId = snapshotProjectId(snapshotResponse.result?.data);
    if (initialProjectId !== project.id) {
      throw new Error(
        "Authenticated WebSocket project snapshot was not scoped to Factory Pilot.",
      );
    }

    const subscriptionStarted = await sendWebSocketRequest(
      socket,
      subscriptionId,
      "subscription",
      "projects.updates",
      { projectId: project.id },
      (message) => message.result?.type === "started",
    );
    if (subscriptionStarted.result?.type !== "started") {
      throw new Error("Authenticated project subscription did not start.");
    }

    const machineApi = createHttpClient(baseUrl, authorization);
    const unauthenticatedApi = createHttpClient(baseUrl);
    const unauthenticatedRead = await expectUnauthorized(
      () => unauthenticatedApi.projects.list.query(),
      "Unauthenticated project read",
    );

    const historyBefore = await remote.getSubtaskReportHistory(subtask.id);
    const markedReportsBefore = historyBefore.filter(
      ({ evidence, reporter }) =>
        evidence === REPORT_EVIDENCE && reporter === REPORTER,
    );
    if (markedReportsBefore.length > 1) {
      throw new Error("More than one pilot synthetic report already exists.");
    }
    let report = markedReportsBefore[0];
    let notification: "received" | "skipped_read_only" = "skipped_read_only";
    let idempotency: "same_report_id" | "read_only_reuse" = "read_only_reuse";
    if (readOnly) {
      if (!report) {
        throw new Error(
          "Read-only pilot check could not find the persisted synthetic report.",
        );
      }
    } else {
      const update = waitForWebSocketMessage(
        socket,
        subscriptionId,
        (message) =>
          message.result?.type === "data" &&
          snapshotHasReportEvidence(
            message.result.data,
            project.id,
            subtask.id,
          ),
      );
      report = await remote.reportSubtaskStatus({
        evidence: REPORT_EVIDENCE,
        reason: REPORT_REASON,
        reportedState: "complete",
        reporter: REPORTER,
        requestKey: REQUEST_KEY,
        subtaskId: subtask.id,
      });
      if (report.machineId !== MACHINE_ID) {
        throw new Error("Synthetic report was not attributed to pilot-agent.");
      }
      const retry = await remote.reportSubtaskStatus({
        evidence: REPORT_EVIDENCE,
        reason: REPORT_REASON,
        reportedState: "complete",
        reporter: REPORTER,
        requestKey: REQUEST_KEY,
        subtaskId: subtask.id,
      });
      if (retry.id !== report.id || retry.machineId !== MACHINE_ID) {
        throw new Error(
          "Retry did not return the same pilot synthetic report.",
        );
      }
      idempotency = "same_report_id";
      const updateMessage = await update;
      if (snapshotProjectId(updateMessage.result?.data) !== project.id) {
        throw new Error(
          "Project subscription update was not scoped to Factory Pilot.",
        );
      }
      notification = "received";
    }

    if (
      !report ||
      report.machineId !== MACHINE_ID ||
      report.reportedState !== "complete"
    ) {
      throw new Error(
        "Synthetic report is incomplete or has the wrong machine attribution.",
      );
    }
    const historyAfter = await remote.getSubtaskReportHistory(subtask.id);
    const durableReports = historyAfter.filter(({ id }) => id === report!.id);
    if (
      durableReports.length !== 1 ||
      durableReports[0]!.machineId !== MACHINE_ID ||
      durableReports[0]!.reportedState !== "complete" ||
      durableReports[0]!.reporter !== REPORTER ||
      durableReports[0]!.evidence !== REPORT_EVIDENCE ||
      durableReports[0]!.reason !== REPORT_REASON
    ) {
      throw new Error(
        "Synthetic report was not found exactly once in durable history.",
      );
    }
    const markedReportsAfter = historyAfter.filter(
      ({ evidence, reporter }) =>
        evidence === REPORT_EVIDENCE && reporter === REPORTER,
    );
    if (
      markedReportsAfter.length !== 1 ||
      markedReportsAfter[0]!.id !== report.id
    ) {
      throw new Error(
        "Pilot synthetic report history contains an unexpected duplicate.",
      );
    }

    const machineVerification = await expectUnauthorized(
      () =>
        machineApi.subtasks.verify.mutate({
          decision: "accepted",
          reportId: report!.id,
        }),
      "Machine verification attempt",
    );

    socket.send(
      JSON.stringify({
        id: subscriptionId,
        method: "subscription.stop",
        params: {},
      }),
    );
    await closeWebSocket(socket);
    socket = await openWebSocket(wsUrl, humanCookie);
    const reopened = await sendWebSocketRequest(
      socket,
      3,
      "query",
      "projects.snapshot",
      { projectId: project.id },
    );
    if (snapshotProjectId(reopened.result?.data) !== project.id) {
      throw new Error(
        "Reopened authenticated WebSocket could not read Factory Pilot.",
      );
    }

    return {
      checks: {
        deploymentJson: "ok",
        healthz: "ok",
        machineVerification: machineVerification,
        readyz: "ok",
        unauthenticatedRead,
        websocketNotification: notification,
        websocketReconnectRead: "ok",
      },
      environment: versionResult.payload.environment,
      historyCount: historyAfter.length,
      idempotency,
      machineId: identity.machine.machineId,
      projectId: project.id,
      projectsVisible: projects.length,
      readOnly,
      reportId: report.id,
      revision: versionResult.payload.revision,
      staticAssets: staticAssetChecks,
      subtaskId: subtask.id,
      taskId: task.id,
      taskSimpleId: task.simpleId,
    };
  } finally {
    await closeWebSocket(socket);
  }
}

try {
  const summary = await main();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
