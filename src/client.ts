import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  installCodexHookTrust,
  type CodexHookTrustInstallOptions,
} from "./codex-hook-trust-install";
import { installSessionHooks } from "./session-hook-install";
import { clientVersionText } from "./client-version";

function flagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function runHookInstaller(args: string[]): void {
  const home = process.env.HOME ?? homedir();
  let claudeSettingsPath = join(home, ".claude", "settings.json");
  let codexHooksPath = join(home, ".codex", "hooks.json");
  let scriptPath = join(
    home,
    ".config",
    "factory",
    "factory-session-brief-hook.sh",
  );
  let dryRun = false;

  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--claude-settings":
        claudeSettingsPath = flagValue(args, index, argument);
        index += 1;
        break;
      case "--codex-hooks":
        codexHooksPath = flagValue(args, index, argument);
        index += 1;
        break;
      case "--script-path":
        scriptPath = flagValue(args, index, argument);
        index += 1;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--json":
        break;
      default:
        throw new Error(`Unknown or incomplete flag: ${argument}`);
    }
  }

  console.log(
    JSON.stringify(
      installSessionHooks({
        claudeSettingsPath,
        claudeSettingsRequired: false,
        codexHooksPath,
        dryRun,
        scriptPath,
      }),
      null,
      2,
    ),
  );
}

export type CodexTrustClientOptions = {
  codexConfigPath?: string;
  dryRun: boolean;
  json: boolean;
};

export function parseCodexTrustArgs(args: string[]): CodexTrustClientOptions {
  const options: CodexTrustClientOptions = {
    dryRun: false,
    json: false,
  };

  for (let index = 2; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--codex-config":
        options.codexConfigPath = resolve(flagValue(args, index, argument));
        index += 1;
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

  return options;
}

async function runCodexTrustInstaller(args: string[]): Promise<void> {
  const options = parseCodexTrustArgs(args);
  const installOptions: CodexHookTrustInstallOptions = {
    codexConfigPath: options.codexConfigPath,
    cwd: process.cwd(),
    dryRun: options.dryRun,
  };
  const trust = await installCodexHookTrust(installOptions);
  console.log(JSON.stringify({ schemaVersion: 1, trust }));
}

export async function runClient(args: string[]): Promise<void> {
  if (args[0] === "--version" || args[0] === "-v") {
    console.log(clientVersionText());
    return;
  }

  if (args[0] === "hooks" && args[1] === "install") {
    runHookInstaller(args);
    return;
  }

  if (args[0] === "hooks" && args[1] === "trust-codex") {
    await runCodexTrustInstaller(args);
    return;
  }

  // The existing CLI keeps its main function private and gates execution on
  // import.meta.main. The build define makes that gate true in the compiled
  // bundle; this source-path adjustment keeps `bun run src/client.ts ...`
  // spawn-free as well.
  if (!process.env.FACTORY_URL?.trim()) {
    throw new Error(
      "FACTORY_URL is required for the compiled Factory client; set FACTORY_URL and FACTORY_ACCESS_TOKEN_FILE.",
    );
  }
  process.env.FACTORY_CLI_COMMAND = "factory";
  if (!import.meta.path.startsWith("/$bunfs/")) {
    (Bun as { main: string }).main = new URL(
      "./cli.ts",
      import.meta.url,
    ).pathname;
  }
  await import("./cli");
}

if (import.meta.main) {
  runClient(Bun.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
