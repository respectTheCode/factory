import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

const repositoryRoot = join(import.meta.dir, "../..");

describe("stable service T3 credential wiring", () => {
  test("passes a file path without reading the T3 token in the launcher", () => {
    const launcher = readFileSync(
      join(repositoryRoot, "scripts/factory-service-launcher.sh"),
      "utf8",
    );
    const plist = readFileSync(
      join(repositoryRoot, "scripts/com.app-press.factory.plist.template"),
      "utf8",
    );
    const deploy = readFileSync(
      join(repositoryRoot, "scripts/deploy-user-service.sh"),
      "utf8",
    );

    expect(plist).toContain("<key>T3_ACCESS_TOKEN_FILE</key>");
    expect(plist).toContain("__SERVICE_ROOT__/secrets/t3-read-token");
    expect(launcher).not.toContain("FACTORY_T3_KEYCHAIN_SERVICE");
    expect(launcher).not.toContain("com.app-press.factory.t3-read-token");
    expect(deploy).toContain(
      'install -d -m 0700 "${FACTORY_SERVICE_ROOT}/secrets"',
    );
  });
});
