import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

const compose = readFileSync(
  join(import.meta.dir, "..", "compose.production.yaml"),
  "utf8",
);

describe("production Compose contract", () => {
  test("keeps the existing project and private Tailscale route", () => {
    expect(compose).toContain("name: factory-pilot-st162-ewgahg");
    expect(compose).toContain(
      "tailscale/tailscale:v1.102.3@sha256:8c42c4574ab066384fcb72f69e086a2ff1dd3652eb6f56856cee34bcf0d2f680",
    );
    expect(compose).toContain("hostname: factory-pilot");
    expect(compose).toContain("TS_HOSTNAME: factory-pilot");
    expect(compose).toContain('TS_USERSPACE: "true"');
    expect(compose).toContain("- tailscale-state:/var/lib/tailscale");
    expect(compose).toContain("- ../files/tailscale:/config:ro");
    expect(compose).toContain(
      '"${FACTORY_BIND_IP:?Set the private LAN address}:${FACTORY_PUBLIC_PORT:-3101}:3000"',
    );
  });

  test("requires a provisioned production database volume", () => {
    expect(compose).toContain("FACTORY_ENVIRONMENT: production");
    expect(compose).toContain('FACTORY_REQUIRE_EXISTING_DB: "true"');
    expect(compose).toContain(
      "name: ${FACTORY_DATA_VOLUME:?FACTORY_DATA_VOLUME must name the provisioned production volume}",
    );
    expect(compose).toContain("external: true");
    expect(compose).not.toContain("FACTORY_DATA_VOLUME:-");
  });

  test("uses the production backup path, source registry, and operator secret", () => {
    expect(compose).toContain(
      "FACTORY_BACKUP_DIR: ${FACTORY_BACKUP_DIR:-/backups/production}",
    );
    expect(compose).toContain('FACTORY_BACKUP_REQUIRE_NFS: "true"');
    expect(compose).toContain(
      "FACTORY_T3_SOURCES_FILE: /run/factory-t3/sources.json",
    );
    expect(compose).toContain("- ../files/t3:/run/factory-t3:ro");
    expect(compose).toContain(
      "- ../files/secrets/production-operator-secret:/run/secrets/factory_operator:ro",
    );
    expect(compose).toContain("name: factory-pilot-backups-nfs");
  });

  test("enforces one non-root writer with stop-first replacement", () => {
    expect(compose).toContain("user: bun");
    expect(compose).toContain("replicas: 1");
    expect(compose).toContain("parallelism: 1");
    expect(compose).toContain("order: stop-first");
    expect(compose).not.toContain("pilot-init");
    expect(compose).not.toContain("profiles:");
  });
});
