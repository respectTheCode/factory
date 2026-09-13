import { copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  findFactoryCodexHook,
  parseJsonRpcLines,
  upsertTrustedHash,
} from "./codex-hook-trust";

type JsonObject = Record<string, unknown>;

export type CodexAppServerProcess = {
  stdin: {
    write(input: string): number | Promise<number>;
    flush(): number | Promise<number>;
  };
  stdout: ReadableStream<Uint8Array<ArrayBuffer>>;
  killed: boolean;
  kill(): void;
};

export type CodexAppServerSpawner = (
  codexBin: string,
  cwd: string,
) => CodexAppServerProcess;

export type CodexHookTrustInstallOptions = {
  codexBin?: string;
  codexConfigPath?: string;
  cwd?: string;
  dryRun?: boolean;
  hookMissingMessage?: string;
  spawnAppServer?: CodexAppServerSpawner;
};

export type CodexHookTrustReport = {
  path: string;
  key: string;
  hash: string;
  previousStatus: "trusted" | "untrusted" | "modified";
  changed: boolean;
  dryRun: boolean;
  backupPath?: string;
};

function asJsonObject(value: unknown): JsonObject | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonObject;
}

export function defaultCodexConfigPath(): string {
  return join(process.env.HOME ?? homedir(), ".codex", "config.toml");
}

export function resolveCodexExecutable(configured?: string): string {
  const requested = configured?.trim() || process.env.CODEX_BIN?.trim();
  if (requested) return Bun.which(requested) ?? requested;

  const codex = Bun.which("codex");
  if (!codex) {
    throw new Error(
      "Codex CLI was not found on PATH; install Codex CLI or add `codex` to PATH.",
    );
  }
  return codex;
}

function jsonRpcRequest(method: string, id: number, params: unknown): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

export async function readHooksListResponse(
  stdout: ReadableStream<Uint8Array<ArrayBuffer>>,
): Promise<unknown> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        const finalLines = parseJsonRpcLines(pending);
        for (const message of finalLines) {
          const object = asJsonObject(message);
          if (object?.id === 2) return message;
        }
        throw new Error(
          "Codex app-server exited before returning the hooks/list response.",
        );
      }

      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        for (const message of parseJsonRpcLines(line)) {
          const object = asJsonObject(message);
          if (object?.id !== 2) continue;
          if (object.error !== undefined) {
            throw new Error(
              `Codex hooks/list failed: ${JSON.stringify(object.error)}`,
            );
          }
          return message;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function spawnCodexAppServer(
  codexBin: string,
  cwd: string,
): CodexAppServerProcess {
  try {
    return Bun.spawn([codexBin, "app-server"], {
      cwd,
      stderr: "ignore",
      stdin: "pipe",
      stdout: "pipe",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/enoent|not found|no such file/i.test(message)) {
      throw new Error(
        "Codex CLI was not found on PATH; install Codex CLI or add `codex` to PATH.",
      );
    }
    throw new Error(`Could not start codex app-server: ${message}`);
  }
}

export async function queryCodexHooks(
  cwd: string,
  codexBin = resolveCodexExecutable(),
  spawnAppServer: CodexAppServerSpawner = spawnCodexAppServer,
): Promise<unknown> {
  const codexProcess = spawnAppServer(codexBin, cwd);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const requests = [
      jsonRpcRequest("initialize", 1, {
        clientInfo: {
          name: "factory-installer",
          title: "Factory",
          version: "0.1",
        },
        capabilities: {},
      }),
      `${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`,
      jsonRpcRequest("hooks/list", 2, { cwd }),
    ].join("");
    await codexProcess.stdin.write(requests);
    await codexProcess.stdin.flush();

    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("Timed out waiting 30 seconds for codex app-server."));
      }, 30_000);
    });
    return await Promise.race([
      readHooksListResponse(codexProcess.stdout),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (!codexProcess.killed) codexProcess.kill();
  }
}

function backupPathFor(configPath: string): string {
  const timestamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");
  return `${configPath}.bak-factory-hook-trust-${timestamp}`;
}

export async function installCodexHookTrust(
  options: CodexHookTrustInstallOptions = {},
): Promise<CodexHookTrustReport> {
  const codexConfigPath = options.codexConfigPath ?? defaultCodexConfigPath();
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const hooksListResult = await queryCodexHooks(
    cwd,
    resolveCodexExecutable(options.codexBin),
    options.spawnAppServer,
  );
  const hook = findFactoryCodexHook(hooksListResult);
  if (hook === undefined) {
    throw new Error(
      options.hookMissingMessage ??
        "Factory Codex hook was not found; run `factory hooks install` first.",
    );
  }
  if (!existsSync(codexConfigPath)) {
    throw new Error(`Codex config file does not exist: ${codexConfigPath}`);
  }

  const configToml = await Bun.file(codexConfigPath).text();
  const trust: CodexHookTrustReport = {
    path: codexConfigPath,
    key: hook.key,
    hash: hook.currentHash,
    previousStatus: hook.trustStatus,
    changed: false,
    dryRun,
  };

  if (hook.trustStatus !== "trusted") {
    const nextConfigToml = upsertTrustedHash(
      configToml,
      hook.key,
      hook.currentHash,
    );
    trust.changed = true;

    if (!dryRun) {
      const backupPath = backupPathFor(codexConfigPath);
      copyFileSync(codexConfigPath, backupPath);
      await Bun.write(codexConfigPath, nextConfigToml);
      trust.backupPath = backupPath;
    }
  }

  return trust;
}
