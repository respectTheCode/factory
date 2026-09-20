import { randomBytes } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const DEPLOY_PROFILES = Object.freeze({
  pilot: Object.freeze({
    environment: "pilot",
    githubRefUrl: new URL(
      "https://api.github.com/repos/respectTheCode/factory/git/ref/heads/deploy%2Ffactory-pilot",
    ),
    versionUrl: new URL("http://192.168.5.50:3101/version"),
    branchRef: "refs/heads/deploy/factory-pilot",
    stateFile: ".factory-pilot-last-request.json",
    webhookLabel: "pilot deployment webhook",
  }),
  production: Object.freeze({
    environment: "production",
    githubRefUrl: new URL(
      "https://api.github.com/repos/respectTheCode/factory/git/ref/heads/deploy%2Ffactory-production",
    ),
    versionUrl: new URL("http://192.168.5.50:3101/version"),
    branchRef: "refs/heads/deploy/factory-production",
    stateFile: ".factory-production-last-request.json",
    webhookLabel: "production deployment webhook",
  }),
});
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_BACKUP_OUTPUT_BYTES = 256 * 1024;
const PREDEPLOY_BACKUP_TIMEOUT_MS = 120_000;
const execFile = promisify(execFileCallback);

function validSha(value) {
  return typeof value === "string" && SHA_PATTERN.test(value.trim());
}

function requireSha(value, label) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!validSha(candidate)) {
    throw new Error(`${label} did not contain a valid 40-character SHA.`);
  }
  return candidate.toLowerCase();
}

function selectDeployProfile(environment) {
  const selected = environment.FACTORY_DEPLOY_ENVIRONMENT?.trim() || "pilot";
  if (!Object.hasOwn(DEPLOY_PROFILES, selected)) {
    throw new Error("FACTORY_DEPLOY_ENVIRONMENT must be pilot or production.");
  }
  return DEPLOY_PROFILES[selected];
}

export function validateWebhookUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "FACTORY_PILOT_WEBHOOK_FILE contains an invalid webhook URL.",
    );
  }

  if (
    url.origin !== "http://192.168.5.50:3000" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/api\/deploy\/compose\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname)
  ) {
    throw new Error(
      "FACTORY_PILOT_WEBHOOK_FILE URL is outside the allowed pilot endpoint.",
    );
  }

  return url;
}

function requestText(url, options = {}) {
  const label = options.label ?? "HTTP request";
  const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return Promise.reject(new Error(`${label} uses an unsupported protocol.`));
  }

  const headers = {
    accept: "application/json",
    "user-agent": "factory-pilot-poller",
    ...(options.headers ?? {}),
  };
  if (options.body !== undefined) {
    headers["content-length"] = Buffer.byteLength(options.body).toString();
  }

  return new Promise((resolveResponse, rejectResponse) => {
    let request;
    let settled = false;
    let timeout;

    const fail = (message) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      request?.destroy();
      rejectResponse(new Error(message));
    };

    const succeed = (response) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolveResponse(response);
    };

    try {
      request = transport(
        {
          hostname: url.hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: options.method ?? "GET",
          headers,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            response.resume();
            fail(`${label} refused a redirect response.`);
            return;
          }

          const chunks = [];
          let responseBytes = 0;
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            responseBytes += Buffer.byteLength(chunk);
            if (responseBytes > MAX_RESPONSE_BYTES) {
              response.destroy();
              fail(`${label} response was too large.`);
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            succeed({ status, body: chunks.join("") });
          });
          response.on("error", () => {
            fail(`${label} response failed.`);
          });
        },
      );
    } catch {
      fail(`${label} could not be started.`);
      return;
    }

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      fail(`${label} timed out.`);
    });
    request.on("error", () => {
      fail(`${label} failed.`);
    });
    if (options.body !== undefined) request.write(options.body);
    request.end();
    timeout = setTimeout(() => fail(`${label} timed out.`), REQUEST_TIMEOUT_MS);
  });
}

async function readGitHubRevision(request, profile) {
  const response = await request(profile.githubRefUrl, {
    label: "GitHub ref request",
    headers: {
      accept: "application/vnd.github+json",
    },
  });
  if (response.status !== 200) {
    throw new Error(`GitHub ref request returned HTTP ${response.status}.`);
  }

  let payload;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new Error("GitHub ref request returned invalid JSON.");
  }
  return requireSha(payload?.object?.sha, "GitHub ref response");
}

async function readRunningRevision(request, profile) {
  const response = await request(profile.versionUrl, {
    label: `${profile.environment} version request`,
  });
  if (response.status !== 200) {
    throw new Error(
      `${profile.environment} version request returned HTTP ${response.status}.`,
    );
  }

  let payload;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new Error(
      `${profile.environment} version request returned invalid JSON.`,
    );
  }
  if (payload?.environment !== profile.environment) {
    throw new Error(
      `${profile.environment} version endpoint did not report the ${profile.environment} environment.`,
    );
  }
  return requireSha(
    payload?.revision,
    `${profile.environment} version response`,
  );
}

async function readLastRequestedSha(statePath) {
  let contents;
  try {
    contents = await readFile(statePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw new Error("Unable to read the pilot poller state file.");
  }

  let state;
  try {
    state = JSON.parse(contents);
  } catch {
    throw new Error("The pilot poller state file is invalid.");
  }
  return requireSha(state?.sha, "Pilot poller state");
}

async function readWebhookUrl(environment) {
  const configuredPath = environment.FACTORY_PILOT_WEBHOOK_FILE?.trim();
  if (!configuredPath || !isAbsolute(configuredPath)) {
    throw new Error("FACTORY_PILOT_WEBHOOK_FILE must be an absolute path.");
  }

  let contents;
  try {
    contents = await readFile(configuredPath, "utf8");
  } catch {
    throw new Error("Unable to read FACTORY_PILOT_WEBHOOK_FILE.");
  }
  return validateWebhookUrl(contents.trim());
}

async function writeLastRequestedSha(statePath, sha, now) {
  const temporaryPath = `${statePath}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  const contents = `${JSON.stringify({
    sha,
    requestedAt: now().toISOString(),
  })}\n`;
  try {
    await writeFile(temporaryPath, contents, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, statePath);
  } catch {
    await unlink(temporaryPath).catch(() => undefined);
    throw new Error("Unable to atomically record the pilot poller state.");
  }
}

export async function runPredeployBackup(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const environment = options.environment ?? process.env;
  const profile = selectDeployProfile(environment);
  const scriptPath = fileURLToPath(
    new URL("./pilot-predeploy-backup.sh", import.meta.url),
  );
  const childEnvironment = {
    ...process.env,
    ...environment,
    FACTORY_DEPLOY_ENVIRONMENT: profile.environment,
  };
  if (options.runningSha) {
    childEnvironment.FACTORY_PILOT_EXPECTED_RUNNING_SHA = options.runningSha;
  }

  try {
    const result = await execFile("bash", [scriptPath], {
      cwd,
      env: childEnvironment,
      maxBuffer: MAX_BACKUP_OUTPUT_BYTES,
      timeout: PREDEPLOY_BACKUP_TIMEOUT_MS,
    });
    const output = result.stdout.trim();
    if (output) process.stdout.write(`${output}\n`);
  } catch {
    throw new Error("Pre-deployment backup failed.");
  }
}

export async function pollPilot(options = {}) {
  const environment = options.environment ?? process.env;
  const profile = selectDeployProfile(environment);
  const selectedEnvironment = {
    ...environment,
    FACTORY_DEPLOY_ENVIRONMENT: profile.environment,
  };
  const cwd = options.cwd ?? process.cwd();
  const request = options.request ?? requestText;
  const now = options.now ?? (() => new Date());

  const releaseSha = await readGitHubRevision(request, profile);
  const runningSha = await readRunningRevision(request, profile);
  if (releaseSha === runningSha) {
    return { status: "no-op", sha: releaseSha };
  }

  const statePath = join(cwd, profile.stateFile);
  const lastRequestedSha = await readLastRequestedSha(statePath);
  if (lastRequestedSha === releaseSha) {
    return { status: "already_requested", sha: releaseSha };
  }

  const webhookUrl = await readWebhookUrl(environment);
  const backup = options.backup ?? runPredeployBackup;
  await backup({
    cwd,
    environment: selectedEnvironment,
    profile,
    releaseSha,
    runningSha,
  });
  const body = JSON.stringify({
    ref: profile.branchRef,
    after: releaseSha,
    head_commit: {
      id: releaseSha,
      message: `Poll release branch ${releaseSha}`,
    },
    commits: [],
  });
  const response = await request(webhookUrl, {
    label: profile.webhookLabel,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "push",
    },
    body,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `${profile.environment} deployment webhook returned HTTP ${response.status}.`,
    );
  }

  await writeLastRequestedSha(statePath, releaseSha, now);
  return { status: "requested", sha: releaseSha };
}

const invokedScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (import.meta.url === invokedScript) {
  pollPilot().then(
    (result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    },
    (error) => {
      process.stderr.write(`poll-pilot: ${error?.message ?? "failed"}\n`);
      process.exitCode = 1;
    },
  );
}
