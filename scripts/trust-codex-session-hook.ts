import { resolve } from "node:path";

import {
  defaultCodexConfigPath,
  installCodexHookTrust,
} from "../src/codex-hook-trust-install";

type TrustOptions = {
  codexConfigPath: string;
  cwd: string;
  dryRun: boolean;
  json: boolean;
};

function parseOptions(args: string[]): TrustOptions {
  const options: TrustOptions = {
    codexConfigPath: resolve(defaultCodexConfigPath()),
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

export async function runTrustCodexSessionHook(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const trust = await installCodexHookTrust({
    ...options,
    hookMissingMessage:
      "Factory Codex hook was not found; run `bun run scripts/install-session-hooks.ts` first.",
  });
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
