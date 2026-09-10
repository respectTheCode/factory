import { resolve } from "node:path";

export type SessionHookClient = "claude" | "codex";

export type SessionHookEntry = {
  command: string;
  timeout?: number;
  matcher?: string;
  /**
   * Codex only: approximate token threshold above which Codex writes the
   * hook's additionalContext to disk and sends a preview instead. Codex
   * defaults to 2500 tokens, which a full brief can exceed.
   */
  additionalContextLimit?: number;
};

export const CODEX_ADDITIONAL_CONTEXT_LIMIT = 4000;
export const FACTORY_SESSION_HOOK_MATCHER = "startup|clear";

type JsonObject = Record<string, unknown>;

function asJsonObject(value: unknown): JsonObject | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonObject;
}

function isFactorySessionHook(value: unknown): value is JsonObject {
  const hook = asJsonObject(value);
  return (
    hook !== undefined &&
    typeof hook.command === "string" &&
    hook.command.includes("factory-session-brief-hook.sh")
  );
}

export function mergeSessionStartHook(
  settings: unknown,
  entry: SessionHookEntry,
): JsonObject {
  const source = asJsonObject(settings) ?? {};
  const merged: JsonObject = { ...source };
  const sourceHooks = asJsonObject(source.hooks);
  const hooks: JsonObject = sourceHooks ? { ...sourceHooks } : {};
  const existingGroups = Array.isArray(hooks.SessionStart)
    ? hooks.SessionStart
    : [];

  let replacedExistingHook = false;
  const sessionStart = existingGroups.map((group) => {
    const groupObject = asJsonObject(group);
    if (!groupObject || !Array.isArray(groupObject.hooks)) {
      return group;
    }

    let replacedInGroup = false;
    const groupHooks = groupObject.hooks.map((hook) => {
      if (!isFactorySessionHook(hook)) return hook;

      replacedExistingHook = true;
      replacedInGroup = true;
      return {
        ...hook,
        command: entry.command,
        ...(entry.additionalContextLimit === undefined
          ? {}
          : { additionalContextLimit: entry.additionalContextLimit }),
      };
    });

    return replacedInGroup
      ? {
          ...groupObject,
          ...(entry.matcher === undefined ? {} : { matcher: entry.matcher }),
          hooks: groupHooks,
        }
      : group;
  });

  if (!replacedExistingHook) {
    sessionStart.push({
      ...(entry.matcher === undefined ? {} : { matcher: entry.matcher }),
      hooks: [
        {
          type: "command",
          command: entry.command,
          timeout: entry.timeout ?? 10,
          ...(entry.additionalContextLimit === undefined
            ? {}
            : { additionalContextLimit: entry.additionalContextLimit }),
        },
      ],
    });
  }

  hooks.SessionStart = sessionStart;
  merged.hooks = hooks;
  return merged;
}

export function factorySessionHookCommand(
  client: SessionHookClient,
  scriptPath: string,
): string {
  const absoluteScriptPath = resolve(scriptPath);
  const quotedScriptPath = absoluteScriptPath.replaceAll("'", "'\\''");
  return `bash '${quotedScriptPath}' ${client}`;
}
