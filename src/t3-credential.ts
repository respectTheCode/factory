import { Buffer } from "node:buffer";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";

export const MAX_T3_ACCESS_TOKEN_BYTES = 16 * 1024;

type T3CredentialEnvironment = {
  T3_ACCESS_TOKEN?: string;
  T3_ACCESS_TOKEN_FILE?: string;
};

export function resolveT3AccessToken(
  environment: T3CredentialEnvironment,
): string | undefined {
  const configuredFile = environment.T3_ACCESS_TOKEN_FILE?.trim();
  if (configuredFile) {
    if (!isAbsolute(configuredFile)) return undefined;
    return readTokenFile(configuredFile);
  }

  return normalizeToken(environment.T3_ACCESS_TOKEN);
}

function readTokenFile(path: string): string | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    const metadata = fstatSync(descriptor);
    if (
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size > MAX_T3_ACCESS_TOKEN_BYTES
    ) {
      return undefined;
    }

    const buffer = Buffer.alloc(MAX_T3_ACCESS_TOKEN_BYTES + 1);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (bytesRead !== metadata.size) return undefined;

    return normalizeToken(buffer.toString("utf8", 0, bytesRead));
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function normalizeToken(value: string | undefined): string | undefined {
  const token = value?.trim();
  if (!token || !/^[\x21-\x7e]+$/.test(token)) return undefined;
  return token;
}
