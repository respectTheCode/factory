import {
  backupFactorySnapshot,
  defaultManifestPath,
  verifyFactorySnapshot,
} from "../src/backup-snapshot";

type Command = "backup" | "verify";

function main(args: string[]): void {
  const command = args[0];
  if (command !== "backup" && command !== "verify") {
    throw new Error(
      "Usage: backup-snapshot.ts backup|verify --database PATH [--output PATH|--manifest PATH]",
    );
  }
  const flags = parseFlags(args.slice(1));
  const database = requiredFlag(flags, "database");

  if (command === "backup") {
    const output = requiredFlag(flags, "output");
    const manifestPath = flags.get("manifest") ?? defaultManifestPath(output);
    const result = backupFactorySnapshot({
      databasePath: database,
      manifestPath,
      outputPath: output,
    });
    console.log(
      JSON.stringify({
        command,
        databasePath: result.databasePath,
        manifestPath: result.manifestPath,
        sha256: result.manifest.snapshot.sha256,
        snapshotPath: result.snapshotPath,
        verified: true,
      }),
    );
    return;
  }

  const manifest = requiredFlag(flags, "manifest");
  const result = verifyFactorySnapshot({
    databasePath: database,
    manifestPath: manifest,
  });
  console.log(
    JSON.stringify({
      command,
      databasePath: result.databasePath,
      manifestPath: result.manifestPath,
      sha256: result.manifest.snapshot.sha256,
      verified: result.verified,
    }),
  );
}

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument?.startsWith("--"))
      throw new Error(`Unexpected argument: ${argument ?? ""}`);
    const name = argument.slice(2);
    if (name !== "database" && name !== "output" && name !== "manifest") {
      throw new Error(`Unknown option: --${name}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Option --${name} requires a value.`);
    if (flags.has(name))
      throw new Error(`Option --${name} was provided more than once.`);
    flags.set(name, value);
    index += 1;
  }
  return flags;
}

function requiredFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name)?.trim();
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

if (import.meta.main) {
  try {
    main(Bun.argv.slice(2));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`backup-snapshot: ${detail}`);
    process.exitCode = 1;
  }
}

export { main };
