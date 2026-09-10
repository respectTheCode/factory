export type CodexHookTrustStatus = "trusted" | "untrusted";

export type FactoryCodexHook = {
  key: string;
  currentHash: string;
  trustStatus: CodexHookTrustStatus;
  enabled: boolean;
};

type JsonObject = Record<string, unknown>;

function asJsonObject(value: unknown): JsonObject | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonObject;
}

function escapeTomlBasicString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function isTableHeader(line: string): boolean {
  return /^\s*\[{1,2}[^\]]+\]{1,2}\s*(?:#.*)?\r?$/.test(line);
}

function replaceTrustedHashLine(
  line: string,
  hash: string,
): string | undefined {
  const quotedValue = line.match(
    /^(\s*trusted_hash\s*=\s*)"(?:\\.|[^"])*"(\s*(?:#.*)?)?(\r?)$/,
  );
  if (quotedValue) {
    return `${quotedValue[1]}"${escapeTomlBasicString(hash)}"${quotedValue[2] ?? ""}${quotedValue[3] ?? ""}`;
  }

  const unquotedValue = line.match(/^(\s*trusted_hash\s*=\s*)(.*?)(\r?)$/);
  if (unquotedValue) {
    return `${unquotedValue[1]}"${escapeTomlBasicString(hash)}"${unquotedValue[3] ?? ""}`;
  }

  return undefined;
}

export function findFactoryCodexHook(
  hooksListResult: unknown,
): FactoryCodexHook | undefined {
  const root = asJsonObject(hooksListResult);
  const result = asJsonObject(root?.result);
  const data = result?.data;
  if (!Array.isArray(data)) {
    throw new Error("Codex hooks/list response did not contain result.data[].");
  }

  const matches: FactoryCodexHook[] = [];
  for (const event of data) {
    const eventObject = asJsonObject(event);
    const hooks = eventObject?.hooks;
    if (!Array.isArray(hooks)) continue;

    for (const candidate of hooks) {
      const hook = asJsonObject(candidate);
      if (
        hook === undefined ||
        typeof hook.command !== "string" ||
        !hook.command.includes("factory-session-brief-hook.sh")
      ) {
        continue;
      }

      if (typeof hook.key !== "string") {
        throw new Error("Factory Codex hook is missing its key.");
      }
      if (typeof hook.currentHash !== "string") {
        throw new Error("Factory Codex hook is missing its current hash.");
      }
      if (hook.trustStatus !== "trusted" && hook.trustStatus !== "untrusted") {
        throw new Error("Factory Codex hook has an invalid trust status.");
      }
      if (typeof hook.enabled !== "boolean") {
        throw new Error("Factory Codex hook is missing its enabled state.");
      }

      matches.push({
        key: hook.key,
        currentHash: hook.currentHash,
        trustStatus: hook.trustStatus,
        enabled: hook.enabled,
      });
    }
  }

  if (matches.length > 1) {
    throw new Error(
      `Found ${matches.length} Factory Codex hooks; expected exactly one.`,
    );
  }

  return matches[0];
}

export function upsertTrustedHash(
  configToml: string,
  key: string,
  hash: string,
): string {
  const escapedKey = escapeTomlBasicString(key);
  const tableHeader = `[hooks.state."${escapedKey}"]`;
  const lines = configToml.split("\n");
  const tableStart = lines.findIndex(
    (line) => line.replace(/\r$/, "") === tableHeader,
  );

  if (tableStart >= 0) {
    let tableEnd = tableStart + 1;
    while (tableEnd < lines.length && !isTableHeader(lines[tableEnd] ?? "")) {
      tableEnd += 1;
    }

    for (let index = tableStart + 1; index < tableEnd; index += 1) {
      const replaced = replaceTrustedHashLine(lines[index] ?? "", hash);
      if (replaced !== undefined) {
        lines[index] = replaced;
        return lines.join("\n");
      }
    }

    lines.splice(
      tableEnd,
      0,
      `trusted_hash = "${escapeTomlBasicString(hash)}"`,
    );
    return lines.join("\n");
  }

  const table = `${tableHeader}\ntrusted_hash = "${escapeTomlBasicString(hash)}"\n`;
  if (configToml.length === 0) return table;

  const withFinalNewline = configToml.endsWith("\n")
    ? configToml
    : `${configToml}\n`;
  const separator = withFinalNewline.endsWith("\n\n") ? "" : "\n";
  return `${withFinalNewline}${separator}${table}`;
}

export function parseJsonRpcLines(text: string): unknown[] {
  const values: unknown[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      values.push(JSON.parse(line) as unknown);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSON-RPC line ${index + 1}: ${message}`);
    }
  }
  return values;
}
