import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { installSessionHooks } from "../src/session-hook-install";

type InstallOptions = {
  claudeSettingsPath: string;
  codexHooksPath: string;
  dryRun: boolean;
  json: boolean;
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

export function runInstaller(args: string[]): void {
  const options = parseOptions(args);
  const scriptPath = resolve(import.meta.dir, "factory-session-brief-hook.sh");
  const report = installSessionHooks({
    claudeSettingsPath: options.claudeSettingsPath,
    claudeSettingsRequired: true,
    codexHooksPath: options.codexHooksPath,
    dryRun: options.dryRun,
    scriptPath,
  });

  // --json is intentionally accepted for callers that require machine output;
  // the installer always emits this stable JSON report.
  void options.json;
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  try {
    runInstaller(process.argv.slice(2));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
