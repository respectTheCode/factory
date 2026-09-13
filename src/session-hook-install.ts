import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  CODEX_ADDITIONAL_CONTEXT_LIMIT,
  FACTORY_SESSION_HOOK_MATCHER,
  factorySessionHookCommand,
  mergeSessionStartHook,
} from "./session-hooks";

export type SessionHookInstallOptions = {
  claudeSettingsPath: string;
  codexHooksPath: string;
  dryRun?: boolean;
  scriptPath: string;
  claudeSettingsRequired?: boolean;
};

export type SessionHookInstallFileResult = {
  path: string;
  changed: boolean;
  dryRun: boolean;
};

export type SessionHookInstallReport = {
  schemaVersion: 1;
  install: {
    claude: SessionHookInstallFileResult;
    codex: SessionHookInstallFileResult;
    scriptPath: string;
    matcher: string;
  };
};

function readSettings(path: string, required: boolean): unknown {
  if (!existsSync(path)) {
    if (required) {
      throw new Error(`Claude settings file does not exist: ${path}`);
    }
    return {};
  }

  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse JSON at ${path}: ${message}`);
  }
}

function installOne(
  path: string,
  client: "claude" | "codex",
  settings: unknown,
  dryRun: boolean,
  scriptPath: string,
): SessionHookInstallFileResult {
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
  const previousContent = existsSync(path) ? readFileSync(path, "utf8") : "";
  const changed = previousContent !== nextContent;

  if (changed && !dryRun) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, nextContent);
  }

  return { path, changed, dryRun };
}

export function installSessionHooks(
  options: SessionHookInstallOptions,
): SessionHookInstallReport {
  const scriptPath = resolve(options.scriptPath);
  const claudeSettingsPath = resolve(options.claudeSettingsPath);
  const codexHooksPath = resolve(options.codexHooksPath);
  const dryRun = options.dryRun ?? false;
  const [claudeSettings, codexHooks] = [
    readSettings(claudeSettingsPath, options.claudeSettingsRequired ?? true),
    readSettings(codexHooksPath, false),
  ];

  return {
    schemaVersion: 1,
    install: {
      claude: installOne(
        claudeSettingsPath,
        "claude",
        claudeSettings,
        dryRun,
        scriptPath,
      ),
      codex: installOne(
        codexHooksPath,
        "codex",
        codexHooks,
        dryRun,
        scriptPath,
      ),
      scriptPath,
      matcher: FACTORY_SESSION_HOOK_MATCHER,
    },
  };
}
