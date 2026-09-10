import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  CODEX_ADDITIONAL_CONTEXT_LIMIT,
  FACTORY_SESSION_HOOK_MATCHER,
  mergeSessionStartHook,
  factorySessionHookCommand,
} from "../src/session-hooks";

type InstallOptions = {
  claudeSettingsPath: string;
  codexHooksPath: string;
  dryRun: boolean;
  json: boolean;
};

type InstallResult = {
  path: string;
  changed: boolean;
  dryRun: boolean;
};

function defaultPath(...parts: string[]): string {
  return join(process.env.HOME ?? homedir(), ...parts);
}

function parseOptions(args: string[]): InstallOptions {
  const options: InstallOptions = {
    claudeSettingsPath: defaultPath(".claude", "settings.json"),
    codexHooksPath: defaultPath(".codex", "hooks.json"),
    dryRun: false,
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--claude-settings":
        options.claudeSettingsPath = args[++index] ?? "";
        break;
      case "--codex-hooks":
        options.codexHooksPath = args[++index] ?? "";
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

  if (!options.claudeSettingsPath || !options.codexHooksPath) {
    throw new Error("Both settings paths require a value");
  }

  return options;
}

async function readSettings(path: string, required: boolean): Promise<unknown> {
  if (!existsSync(path)) {
    if (required) {
      throw new Error(`Claude settings file does not exist: ${path}`);
    }
    return {};
  }

  try {
    return JSON.parse(await Bun.file(path).text()) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse JSON at ${path}: ${message}`);
  }
}

async function installOne(
  path: string,
  client: "claude" | "codex",
  settings: unknown,
  dryRun: boolean,
  scriptPath: string,
): Promise<InstallResult> {
  const command = factorySessionHookCommand(client, scriptPath);
  const merged = mergeSessionStartHook(settings, {
    command,
    timeout: 10,
    matcher: FACTORY_SESSION_HOOK_MATCHER,
    ...(client === "codex"
      ? { additionalContextLimit: CODEX_ADDITIONAL_CONTEXT_LIMIT }
      : {}),
  });
  const nextContent = `${JSON.stringify(merged, null, 2)}\n`;
  const previousContent = existsSync(path) ? await Bun.file(path).text() : "";
  const changed = previousContent !== nextContent;

  if (changed && !dryRun) {
    mkdirSync(dirname(path), { recursive: true });
    await Bun.write(path, nextContent);
  }

  return { path, changed, dryRun };
}

export async function runInstaller(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const scriptPath = resolve(import.meta.dir, "factory-session-brief-hook.sh");
  const [claudeSettings, codexHooks] = await Promise.all([
    readSettings(options.claudeSettingsPath, true),
    readSettings(options.codexHooksPath, false),
  ]);

  const [claude, codex] = await Promise.all([
    installOne(
      options.claudeSettingsPath,
      "claude",
      claudeSettings,
      options.dryRun,
      scriptPath,
    ),
    installOne(
      options.codexHooksPath,
      "codex",
      codexHooks,
      options.dryRun,
      scriptPath,
    ),
  ]);

  const report = {
    schemaVersion: 1,
    install: {
      claude,
      codex,
      scriptPath,
      matcher: FACTORY_SESSION_HOOK_MATCHER,
    },
  };

  // --json is intentionally accepted for callers that require machine output;
  // the installer always emits this stable JSON report.
  void options.json;
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  runInstaller(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
