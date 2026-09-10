import { copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  findFactoryCodexHook,
  parseJsonRpcLines,
  upsertTrustedHash,
} from "../src/codex-hook-trust";

type TrustOptions = {
  codexConfigPath: string;
  cwd: string;
  dryRun: boolean;
  json: boolean;
};

type JsonObject = Record<string, unknown>;

function asJsonObject(value: unknown): JsonObject | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonObject;
}

function defaultConfigPath(): string {
  return join(process.env.HOME ?? homedir(), ".codex", "config.toml");
}

function parseOptions(args: string[]): TrustOptions {
  const options: TrustOptions = {
    codexConfigPath: resolve(defaultConfigPath()),
    cwd: resolve(import.meta.dir, ".."),
    dryRun: false,
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--codex-config":
        {
          const value = args[++index];
          if (!value) throw new Error("--codex-config requires a path");
          options.codexConfigPath = resolve(value);
        }
        break;
      case "--cwd":
        {
          const value = args[++index];
          if (!value) throw new Error("--cwd requires a path");
          options.cwd = resolve(value);
        }
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        throw new Error(`Unknown or incomplete flag: ${argument}`);
    }
  }

  if (!options.codexConfigPath || !options.cwd) {
    throw new Error("Both --codex-config and --cwd require a path");
  }

  return options;
}

function jsonRpcRequest(method: string, id: number, params: unknown): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

async function readHooksListResponse(
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

async function queryCodexHooks(cwd: string): Promise<unknown> {
  let codexProcess: ReturnType<typeof Bun.spawn>;
  try {
    codexProcess = Bun.spawn(["codex", "app-server"], {
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

export async function runTrustCodexSessionHook(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const hooksListResult = await queryCodexHooks(options.cwd);
  const hook = findFactoryCodexHook(hooksListResult);
  if (hook === undefined) {
    throw new Error(
      "Factory Codex hook was not found; run `bun run scripts/install-session-hooks.ts` first.",
    );
  }
  if (!existsSync(options.codexConfigPath)) {
    throw new Error(
      `Codex config file does not exist: ${options.codexConfigPath}`,
    );
  }

  const configToml = await Bun.file(options.codexConfigPath).text();
  const trust = {
    path: options.codexConfigPath,
    key: hook.key,
    hash: hook.currentHash,
    previousStatus: hook.trustStatus,
    changed: false,
    dryRun: options.dryRun,
  };

  if (hook.trustStatus !== "trusted") {
    const nextConfigToml = upsertTrustedHash(
      configToml,
      hook.key,
      hook.currentHash,
    );
    trust.changed = true;

    if (!options.dryRun) {
      const backupPath = backupPathFor(options.codexConfigPath);
      copyFileSync(options.codexConfigPath, backupPath);
      await Bun.write(options.codexConfigPath, nextConfigToml);
      Object.assign(trust, { backupPath });
    }
  }

  void options.json;
  console.log(JSON.stringify({ schemaVersion: 1, trust }));
}

if (import.meta.main) {
  runTrustCodexSessionHook(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
