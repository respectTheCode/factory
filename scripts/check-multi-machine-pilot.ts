import { isAbsolute, resolve } from "node:path";

import { FACTORY_API_VERSION } from "../src/api-version";
import {
  createRemoteFactoryClient,
  FACTORY_REQUEST_KEY_PATTERN,
  resolveFactoryAccessToken,
  validateFactoryUrl,
} from "../src/remote-client";

const REQUEST_TIMEOUT_MS = 10_000;
const REPORTER = "pilot-smoke";
const REPORT_REASON = "ST-164 pilot validation; awaiting human verification.";

type Arguments = {
  flags: Map<string, string | true>;
};

type VersionIdentity = {
  apiVersion: number;
  environment: "development" | "pilot" | "production";
  revision: string;
  schemaVersion: 1;
};

type JsonRecord = Record<string, unknown>;

type TRPCBody = {
  error?: { data?: { code?: string }; message?: string };
  result?: { data?: unknown };
};

type WsMessage = {
  error?: unknown;
  id?: number | string;
  result?: { data?: unknown; type?: string };
};

function parseArguments(args: string[]): Arguments {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${value ?? ""}`);
    }
    const name = value.slice(2);
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) {
      if (name !== "help" && name !== "read-only") {
        throw new Error(`Flag --${name} requires a value.`);
      }
      flags.set(name, true);
      continue;
    }
    flags.set(name, next);
    index += 1;
  }
  return { flags };
}

function requiredFlag(flags: Map<string, string | true>, name: string): string {
  const value = flags.get(name);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`--${name} is required.`);
  }
  return value.trim();
}

function optionalFlag(
  flags: Map<string, string | true>,
  name: string,
): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value.trim() : undefined;
}

function absolutePath(flags: Map<string, string | true>, name: string): string {
  const value = requiredFlag(flags, name);
  if (!isAbsolute(value)) throw new Error(`--${name} must be absolute.`);
  return resolve(value);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${pathname} returned invalid JSON.`);
  }
  return { payload, response };
}

function isPilotIdentity(value: unknown): value is VersionIdentity {
  return (
    isRecord(value) &&
    value.apiVersion === FACTORY_API_VERSION &&
    value.environment === "pilot" &&
    typeof value.revision === "string" &&
    value.schemaVersion === 1
  );
}

function recordId(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  return value.id;
}

function recordMatchesId(value: unknown, id: string): boolean {
  if (!isRecord(value)) return false;
  return value.id === id || value.simpleId === id;
}

function reportMarker(prefix: string, slot: "a" | "b"): string {
  return `ST-164 pilot synthetic report ${prefix}/${slot}`;
}

function reportKey(prefix: string, slot: "a" | "b"): string {
  return `${prefix}-${slot}`;
}

function requireRequestKey(value: string): string {
  if (!FACTORY_REQUEST_KEY_PATTERN.test(value)) {
    throw new Error(
      "--request-key-prefix must produce request keys matching the Factory request-key contract.",
    );
  }
  return value;
}

function reportFromHistory(
  history: unknown,
  evidence: string,
): JsonRecord | undefined {
  if (!Array.isArray(history)) return undefined;
  const matches = history.filter(
    (item): item is JsonRecord => isRecord(item) && item.evidence === evidence,
  );
  if (matches.length > 1) {
    throw new Error(
      "Pilot synthetic report history contains a duplicate marker.",
    );
  }
  return matches[0];
}

function createHttpClient(baseUrl: string, token: string) {
  return {
    async call(
      path: string,
      input: unknown,
      method: "GET" | "POST" = "GET",
    ): Promise<{ response: Response; body: TRPCBody }> {
      const url = endpoint(baseUrl, `/api/${path}`);
      const requestUrl = new URL(url);
      const init: RequestInit = {
        headers: { Authorization: `Bearer ${token}` },
        method,
      };
      if (method === "GET") {
        requestUrl.searchParams.set("input", JSON.stringify(input));
      } else {
        init.body = JSON.stringify(input);
        init.headers = {
          ...init.headers,
          "Content-Type": "application/json",
        };
      }
      const response = await request(requestUrl.toString(), init);
      let body: TRPCBody = {};
      try {
        body = (await response.json()) as TRPCBody;
      } catch {
        // The status is the useful assertion for an authorization denial.
      }
      return { body, response };
    },
  };
}

async function expectMachineDenied(
  client: ReturnType<typeof createHttpClient>,
  path: string,
  input: unknown,
  label: string,
): Promise<void> {
  const result = await client.call(path, input, "POST");
  if (
    result.response.status !== 401 ||
    result.body.error?.data?.code !== "UNAUTHORIZED"
  ) {
    throw new Error(`${label} was not denied to the machine credential.`);
  }
}

function createWebSocket(url: string, token: string): WebSocket {
  const BunWebSocket = WebSocket as unknown as new (
    url: string,
    options: { headers: Record<string, string> },
  ) => WebSocket;
  return new BunWebSocket(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function openWebSocket(url: string, token: string): Promise<WebSocket> {
  const socket = createWebSocket(url, token);
  await new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Authenticated pilot WebSocket connection timed out."));
    }, REQUEST_TIMEOUT_MS);
    const onOpen = () => {
      clearTimeout(timeout);
      socket.removeEventListener("error", onError);
      resolvePromise();
    };
    const onError = () => {
      clearTimeout(timeout);
      socket.removeEventListener("open", onOpen);
      reject(new Error("Authenticated pilot WebSocket connection failed."));
    };
    socket.addEventListener("open", onOpen, { once: true });
    socket.addEventListener("error", onError, { once: true });
  });
  return socket;
}

function waitForWebSocketMessage(
  socket: WebSocket,
  id: number,
): Promise<WsMessage> {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Pilot WebSocket response ${id} timed out.`));
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
      if (message.id !== id) return;
      cleanup();
      resolvePromise(message);
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Pilot WebSocket request ${id} failed.`));
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`Pilot WebSocket closed for request ${id}.`));
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

async function websocketSnapshot(
  socket: WebSocket,
  id: number,
  projectId: string,
): Promise<void> {
  const pending = waitForWebSocketMessage(socket, id);
  socket.send(
    JSON.stringify({
      id,
      method: "query",
      params: { input: { projectId }, path: "projects.snapshot" },
    }),
  );
  const message = await pending;
  if (message.error || !isRecord(message.result?.data)) {
    throw new Error("Authenticated pilot WebSocket snapshot was rejected.");
  }
  const snapshot = message.result?.data;
  const projectDetail = snapshot.projectDetail;
  if (!isRecord(projectDetail) || projectDetail.id !== projectId) {
    throw new Error(
      "Pilot WebSocket snapshot was not scoped to the supplied Project.",
    );
  }
}

async function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolvePromise) => {
    const timeout = setTimeout(resolvePromise, 1_000);
    socket.addEventListener(
      "close",
      () => {
        clearTimeout(timeout);
        resolvePromise();
      },
      { once: true },
    );
    socket.close();
  });
}

async function validateMachineIdentity(
  client: ReturnType<typeof createRemoteFactoryClient>,
  projectId: string,
  expectedMachineId: string | undefined,
  slot: "a" | "b",
): Promise<string> {
  const identity = await client.whoami();
  if (!identity.machine) {
    throw new Error(`Machine ${slot} did not authenticate as a machine.`);
  }
  if (expectedMachineId && identity.machine.machineId !== expectedMachineId) {
    throw new Error(
      `Machine ${slot} identity did not match --machine-${slot}-id.`,
    );
  }
  if (!identity.machine.projectIds.includes(projectId)) {
    throw new Error(`Machine ${slot} is not scoped to the supplied Project.`);
  }
  return identity.machine.machineId;
}

async function validateProjectCoordinates(
  client: ReturnType<typeof createRemoteFactoryClient>,
  projectId: string,
  taskId: string,
  subtaskId: string,
  slot: "a" | "b",
): Promise<{ taskId: string; subtaskId: string }> {
  const context = await client.getProjectContext({ projectId });
  if (context.id !== projectId) {
    throw new Error(`Machine ${slot} read a different Project than supplied.`);
  }
  const task = context.tasks.find((candidate) =>
    recordMatchesId(candidate, taskId),
  );
  if (!task)
    throw new Error(
      `Machine ${slot} could not read the supplied Task in the Project.`,
    );
  const subtask = task.subtasks.find((candidate) =>
    recordMatchesId(candidate, subtaskId),
  );
  if (!subtask) {
    throw new Error(
      `Machine ${slot} could not read the supplied Subtask under the Task.`,
    );
  }
  const resolvedTaskId = recordId(task);
  const resolvedSubtaskId = recordId(subtask);
  if (!resolvedTaskId || !resolvedSubtaskId) {
    throw new Error(
      `Machine ${slot} returned an invalid pilot record identity.`,
    );
  }
  return { subtaskId: resolvedSubtaskId, taskId: resolvedTaskId };
}

async function reportSlot({
  client,
  evidence,
  existingHistory,
  readOnly,
  requestKey,
  machineId,
  subtaskId,
}: {
  client: ReturnType<typeof createRemoteFactoryClient>;
  evidence: string;
  existingHistory: unknown;
  readOnly: boolean;
  requestKey: string;
  machineId: string;
  subtaskId: string;
}): Promise<{ id: string; mode: "created" | "reused" }> {
  const existing = reportFromHistory(existingHistory, evidence);
  if (existing) {
    if (existing.machineId !== machineId) {
      throw new Error(
        "Pilot synthetic report marker has the wrong machine attribution.",
      );
    }
    const id = recordId(existing);
    if (!id)
      throw new Error("Pilot synthetic report marker has no durable ID.");
    return { id, mode: "reused" };
  }
  if (readOnly) {
    throw new Error(`Read-only pilot check could not find ${evidence}.`);
  }
  const input = {
    evidence,
    reason: REPORT_REASON,
    reportedState: "complete" as const,
    reporter: REPORTER,
    requestKey,
    subtaskId,
  };
  const [first, concurrentRetry] = await Promise.all([
    client.reportSubtaskStatus(input),
    client.reportSubtaskStatus(input),
  ]);
  if (!first.id || first.id !== concurrentRetry.id) {
    throw new Error(
      "Concurrent pilot report retry did not return one durable report ID.",
    );
  }
  if (first.machineId !== machineId) {
    throw new Error(
      "Pilot synthetic report was not attributed to its credential-bound machine.",
    );
  }
  return { id: first.id, mode: "created" };
}

async function verifyDurableReport(
  history: unknown,
  evidence: string,
  reportId: string,
  machineId: string,
  subtaskId: string,
): Promise<void> {
  const report = reportFromHistory(history, evidence);
  if (
    !report ||
    report.id !== reportId ||
    report.subtaskId !== subtaskId ||
    report.machineId !== machineId ||
    report.reportedState !== "complete" ||
    report.reporter !== REPORTER ||
    report.reason !== REPORT_REASON
  ) {
    throw new Error(
      "Pilot synthetic report was not durably read back with the expected metadata.",
    );
  }
}

async function verifyWebSocketReconnect(
  baseUrl: string,
  token: string,
  projectId: string,
): Promise<void> {
  const wsUrl = `${baseUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:")}/trpc`;
  let socket = await openWebSocket(wsUrl, token);
  try {
    await websocketSnapshot(socket, 1, projectId);
    await closeWebSocket(socket);
    socket = await openWebSocket(wsUrl, token);
    await websocketSnapshot(socket, 2, projectId);
  } finally {
    await closeWebSocket(socket);
  }
}

async function verifyRevokedCredential(
  baseUrl: string,
  tokenFile: string,
  machineId: string | undefined,
): Promise<void> {
  if (machineId && !/^pilot-[a-z0-9][a-z0-9-]*$/.test(machineId)) {
    throw new Error(
      "--revoked-machine-id must identify a disposable pilot credential (pilot-*).",
    );
  }
  const token = resolveFactoryAccessToken(tokenFile);
  if (!token)
    throw new Error(
      "--revoked-token-file must contain a readable machine token.",
    );
  const client = createHttpClient(baseUrl, token);
  const result = await client.call("session.whoami", null, "GET");
  if (
    result.response.status !== 401 ||
    result.body.error?.data?.code !== "UNAUTHORIZED"
  ) {
    throw new Error(
      "The disposable pilot credential was not denied after revocation.",
    );
  }
}

async function main(): Promise<Record<string, unknown>> {
  const { flags } = parseArguments(process.argv.slice(2));
  if (flags.has("help")) {
    process.stdout.write(
      "Usage: bun run scripts/check-multi-machine-pilot.ts --factory-url URL --project-id ID --task-id ID --subtask-id ID --machine-a-token-file PATH --machine-b-token-file PATH [--machine-a-id ID --machine-b-id ID --request-key-prefix PREFIX --read-only --revoked-token-file PATH --revoked-machine-id ID]\n",
    );
    return { help: true };
  }

  const baseUrl = validateFactoryUrl(requiredFlag(flags, "factory-url"));
  const projectId = requiredFlag(flags, "project-id");
  const taskId = requiredFlag(flags, "task-id");
  const subtaskId = requiredFlag(flags, "subtask-id");
  const tokenFileA = absolutePath(flags, "machine-a-token-file");
  const tokenFileB = absolutePath(flags, "machine-b-token-file");
  if (tokenFileA === tokenFileB) {
    throw new Error("Machine A and B must use separate token files.");
  }
  const revokedTokenFileValue = optionalFlag(flags, "revoked-token-file");
  const revokedMachineId = optionalFlag(flags, "revoked-machine-id");
  if (revokedMachineId && !revokedTokenFileValue) {
    throw new Error("--revoked-machine-id requires --revoked-token-file.");
  }
  if (revokedTokenFileValue && !revokedMachineId) {
    throw new Error("--revoked-token-file requires --revoked-machine-id.");
  }
  if (revokedTokenFileValue && !isAbsolute(revokedTokenFileValue)) {
    throw new Error("--revoked-token-file must be absolute.");
  }
  if (
    revokedTokenFileValue &&
    [tokenFileA, tokenFileB].includes(resolve(revokedTokenFileValue))
  ) {
    throw new Error(
      "The revoked token file must be separate from both active pilot token files.",
    );
  }
  const readOnly = flags.get("read-only") === true;
  const requestKeyPrefix =
    optionalFlag(flags, "request-key-prefix") ??
    `st164-pilot-${projectId.slice(0, 16)}`;
  const requestKeyA = requireRequestKey(reportKey(requestKeyPrefix, "a"));
  const requestKeyB = requireRequestKey(reportKey(requestKeyPrefix, "b"));

  // This unauthenticated guard intentionally precedes reading either token file.
  const versionResult = await jsonResponse(baseUrl, "/version");
  if (!versionResult.response.ok || !isPilotIdentity(versionResult.payload)) {
    const environment =
      isRecord(versionResult.payload) &&
      typeof versionResult.payload.environment === "string"
        ? versionResult.payload.environment
        : "unknown";
    throw new Error(
      `Refusing to run: Factory environment is ${environment}, not pilot.`,
    );
  }

  const tokenA = resolveFactoryAccessToken(tokenFileA);
  const tokenB = resolveFactoryAccessToken(tokenFileB);
  if (!tokenA || !tokenB) {
    throw new Error(
      "Machine token files must be absolute readable files containing printable tokens.",
    );
  }
  const clientA = createRemoteFactoryClient({
    FACTORY_ACCESS_TOKEN_FILE: tokenFileA,
    FACTORY_URL: baseUrl,
  });
  const clientB = createRemoteFactoryClient({
    FACTORY_ACCESS_TOKEN_FILE: tokenFileB,
    FACTORY_URL: baseUrl,
  });
  const machineIdA = await validateMachineIdentity(
    clientA,
    projectId,
    optionalFlag(flags, "machine-a-id"),
    "a",
  );
  const machineIdB = await validateMachineIdentity(
    clientB,
    projectId,
    optionalFlag(flags, "machine-b-id"),
    "b",
  );
  if (machineIdA === machineIdB)
    throw new Error(
      "Machine A and B must have distinct credential-bound identities.",
    );

  const coordinatesA = await validateProjectCoordinates(
    clientA,
    projectId,
    taskId,
    subtaskId,
    "a",
  );
  const coordinatesB = await validateProjectCoordinates(
    clientB,
    projectId,
    taskId,
    subtaskId,
    "b",
  );
  if (
    coordinatesA.taskId !== coordinatesB.taskId ||
    coordinatesA.subtaskId !== coordinatesB.subtaskId
  ) {
    throw new Error(
      "The two machines resolved different pilot Task or Subtask records.",
    );
  }
  const resolvedTaskId = coordinatesA.taskId;
  const resolvedSubtaskId = coordinatesA.subtaskId;

  const historyBefore =
    await clientA.getSubtaskReportHistory(resolvedSubtaskId);
  const [reportA, reportB] = await Promise.all([
    reportSlot({
      client: clientA,
      evidence: reportMarker(requestKeyPrefix, "a"),
      existingHistory: historyBefore,
      machineId: machineIdA,
      readOnly,
      requestKey: requestKeyA,
      subtaskId: resolvedSubtaskId,
    }),
    reportSlot({
      client: clientB,
      evidence: reportMarker(requestKeyPrefix, "b"),
      existingHistory: historyBefore,
      machineId: machineIdB,
      readOnly,
      requestKey: requestKeyB,
      subtaskId: resolvedSubtaskId,
    }),
  ]);
  const historyAfter = await clientA.getSubtaskReportHistory(resolvedSubtaskId);
  await verifyDurableReport(
    historyAfter,
    reportMarker(requestKeyPrefix, "a"),
    reportA.id,
    machineIdA,
    resolvedSubtaskId,
  );
  await verifyDurableReport(
    historyAfter,
    reportMarker(requestKeyPrefix, "b"),
    reportB.id,
    machineIdB,
    resolvedSubtaskId,
  );

  const machineHttpA = createHttpClient(baseUrl, tokenA);
  const machineHttpB = createHttpClient(baseUrl, tokenB);
  await expectMachineDenied(
    machineHttpA,
    "subtasks.verify",
    { decision: "accepted", reportId: reportA.id },
    "Machine A verification",
  );
  await expectMachineDenied(
    machineHttpB,
    "subtasks.verify",
    { decision: "accepted", reportId: reportB.id },
    "Machine B verification",
  );
  const backupA = await machineHttpA.call("backups.list", null, "GET");
  const backupB = await machineHttpB.call("backups.list", null, "GET");
  for (const [slot, result] of [
    ["a", backupA],
    ["b", backupB],
  ] as const) {
    if (
      result.response.status !== 401 ||
      result.body.error?.data?.code !== "UNAUTHORIZED"
    ) {
      throw new Error(`Machine ${slot} backup access was not denied.`);
    }
  }

  await verifyWebSocketReconnect(baseUrl, tokenA, projectId);
  if (revokedTokenFileValue) {
    await verifyRevokedCredential(
      baseUrl,
      resolve(revokedTokenFileValue),
      revokedMachineId,
    );
  }

  return {
    checks: {
      machineBackup: "denied",
      machineVerification: "denied",
      projectCoordinates: "ok",
      reports: "durable",
      websocketReconnect: "ok",
      ...(revokedTokenFileValue ? { revokedCredential: "denied" } : {}),
    },
    environment: versionResult.payload.environment,
    idempotency: {
      machineA: reportA.mode,
      machineB: reportB.mode,
      concurrentRetries:
        reportA.mode === "created" && reportB.mode === "created"
          ? "same-id"
          : "reused",
    },
    machineIds: [machineIdA, machineIdB],
    projectId,
    reportIds: [reportA.id, reportB.id],
    revision: versionResult.payload.revision,
    subtaskId: resolvedSubtaskId,
    taskId: resolvedTaskId,
  };
}

if (import.meta.main) {
  try {
    const summary = await main();
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
