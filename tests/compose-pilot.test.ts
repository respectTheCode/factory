import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

const compose = readFileSync(
  join(import.meta.dir, "..", "compose.pilot.yaml"),
  "utf8",
);

describe("pilot Compose contract", () => {
  test("keeps the existing data volume as the default while allowing an isolated copy", () => {
    expect(compose).toContain(
      "name: ${FACTORY_PILOT_DATA_VOLUME:-factory-pilot-st162-data}",
    );
    expect(compose.match(/- factory-data:\/data/g)).toHaveLength(2);
  });

  test("keeps backups configurable without changing the NFS volume contract", () => {
    expect(compose).toContain(
      "FACTORY_BACKUP_DIR: ${FACTORY_PILOT_BACKUP_DIR:-/backups/pilot}",
    );
    expect(compose).toContain("factory-backups:");
    expect(compose).toContain("name: factory-pilot-backups-nfs");
    expect(compose).toContain("external: true");
  });

  test("mounts the optional operator-provisioned T3 registry read-only", () => {
    expect(compose).toContain(
      "FACTORY_T3_SOURCES_FILE: ${FACTORY_T3_SOURCES_FILE:-}",
    );
    expect(compose).toContain("- ../files/t3:/run/factory-t3:ro");
  });
});
