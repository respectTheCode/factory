import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REVISION_PATTERN = /^[0-9a-f]{40}$/;
const OVERRIDE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const gitDirectory = join(process.cwd(), ".git");
const revisionFile = join(process.cwd(), "REVISION");

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return undefined;
  }
}

function assertRevision(value: string, source: string): string {
  if (!REVISION_PATTERN.test(value)) {
    throw new Error(
      `${source} must contain a 40-character lowercase commit SHA.`,
    );
  }
  return value;
}

function resolveLooseRef(ref: string): string | undefined {
  // Only branch refs are copied into the build context. Reject traversal and
  // malformed ref names before constructing a path below .git.
  if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(ref) || ref.includes("..")) {
    throw new Error(`Unsupported Git ref in HEAD: ${ref}`);
  }
  return readText(join(gitDirectory, ref));
}

function resolvePackedRef(ref: string): string | undefined {
  const packedRefs = readText(join(gitDirectory, "packed-refs"));
  if (!packedRefs) return undefined;
  for (const line of packedRefs.split("\n")) {
    if (!line || line.startsWith("#") || line.startsWith("^")) continue;
    const separator = line.indexOf(" ");
    if (separator < 0) continue;
    if (line.slice(separator + 1) === ref) return line.slice(0, separator);
  }
  return undefined;
}

function resolveGitRevision(): string {
  const head = readText(join(gitDirectory, "HEAD"));
  if (!head) {
    throw new Error("Cannot resolve a revision: .git/HEAD is unavailable.");
  }

  if (head.startsWith("ref: ")) {
    const ref = head.slice("ref: ".length).trim();
    const looseRevision = resolveLooseRef(ref);
    if (looseRevision) return assertRevision(looseRevision, `Git ref ${ref}`);
    const packedRevision = resolvePackedRef(ref);
    if (packedRevision) return assertRevision(packedRevision, `Git ref ${ref}`);
    throw new Error(`Cannot resolve Git ref ${ref} from loose or packed refs.`);
  }

  return assertRevision(head, "Detached Git HEAD");
}

function main(): void {
  const override = process.env.FACTORY_REVISION?.trim();
  const revision = override
    ? (() => {
        if (!OVERRIDE_PATTERN.test(override)) {
          throw new Error(
            "FACTORY_REVISION must be a commit SHA or a short deployment-safe revision label.",
          );
        }
        return override;
      })()
    : resolveGitRevision();

  writeFileSync(revisionFile, `${revision}\n`, {
    encoding: "utf8",
    mode: 0o644,
  });
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
