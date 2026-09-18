import {
  accessSync,
  chmodSync,
  constants as fsConstants,
  linkSync,
  lstatSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";

import { createFactoryApplication } from "../src/application";
import { createMachineCredentialStore } from "../src/machine-credential";

const PILOT_ENVIRONMENT = "pilot";
const DEFAULT_TOKEN_PATH = "/data/pilot-agent-token";
const PILOT_MACHINE_ID = "pilot-agent";

type PilotOptions = {
  databasePath: string;
  tokenPath: string;
};

function usage(): never {
  throw new Error(
    "Usage: bun scripts/init-pilot.ts --database /data/factory.sqlite [--machine-token-file /data/pilot-agent-token]",
  );
}

function parseOptions(argv: string[]): PilotOptions {
  let databasePath: string | undefined;
  let tokenPath =
    process.env.PILOT_MACHINE_TOKEN_FILE?.trim() || DEFAULT_TOKEN_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--database") {
      databasePath = argv[++index];
      continue;
    }
    if (argument === "--machine-token-file") {
      tokenPath = argv[++index] ?? "";
      continue;
    }
    if (argument === "--help" || argument === "-h") usage();
    usage();
  }

  const configuredDatabase = databasePath ?? process.env.FACTORY_DB?.trim();
  if (!configuredDatabase || !isAbsolute(configuredDatabase)) {
    throw new Error(
      "Pilot initialization requires an absolute --database path or FACTORY_DB.",
    );
  }
  if (!isAbsolute(tokenPath)) {
    throw new Error(
      "--machine-token-file/PILOT_MACHINE_TOKEN_FILE must be absolute.",
    );
  }

  return {
    databasePath: resolve(configuredDatabase),
    tokenPath: resolve(tokenPath),
  };
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function removeIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function assertNewDatabase(databasePath: string): void {
  for (const path of [
    databasePath,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ]) {
    if (pathExists(path)) {
      throw new Error(
        `Refusing to initialize an existing database path: ${path}`,
      );
    }
  }
}

function prepareTokenPath(tokenPath: string): void {
  if (pathExists(tokenPath)) {
    throw new Error(
      `Refusing to overwrite an existing machine token file: ${tokenPath}`,
    );
  }
  mkdirSync(dirname(tokenPath), { recursive: true });
  try {
    accessSync(dirname(tokenPath), fsConstants.W_OK);
  } catch {
    throw new Error(
      `Machine token directory is not writable: ${dirname(tokenPath)}`,
    );
  }
}

function main(): void {
  if (process.env.FACTORY_ENVIRONMENT?.trim() !== PILOT_ENVIRONMENT) {
    throw new Error(
      `Pilot initialization requires FACTORY_ENVIRONMENT=${PILOT_ENVIRONMENT}.`,
    );
  }

  const options = parseOptions(process.argv.slice(2));
  assertNewDatabase(options.databasePath);
  prepareTokenPath(options.tokenPath);
  const temporaryDatabasePath = `${options.databasePath}.pilot-init-${randomUUID()}.tmp`;
  const temporaryTokenPath = `${options.tokenPath}.pilot-init-${randomUUID()}.tmp`;
  let publishedDatabase = false;
  let publishedToken = false;
  let seedIds:
    | {
        projectId: string;
        subtaskIds: string[];
        taskId: string;
      }
    | undefined;
  try {
    mkdirSync(dirname(options.databasePath), { recursive: true });

    const application = createFactoryApplication({
      databasePath: temporaryDatabasePath,
      refreshBeforeOperations: false,
    });
    const seed = (() => {
      try {
        const project = application.createProject({
          name: "Factory Pilot",
          workspaceRoot: "/pilot/factory",
        });
        const task = application.createTask({
          name: "Pilot container smoke test",
          objective:
            "Exercise authenticated reporting and human verification in the isolated pilot.",
          projectId: project.id,
          workState: "planned",
        });
        const reportSubtask = application.createSubtask({
          description:
            "Report a completion update with the pilot-agent credential.",
          name: "Submit a pilot report",
          taskId: task.id,
        });
        const verifySubtask = application.createSubtask({
          description:
            "Accept the pilot report through the authenticated human dashboard.",
          name: "Verify the pilot report",
          taskId: task.id,
        });
        return { project, reportSubtask, task, verifySubtask };
      } finally {
        application.close();
      }
    })();
    seedIds = {
      projectId: seed.project.id,
      subtaskIds: [seed.reportSubtask.id, seed.verifySubtask.id],
      taskId: seed.task.id,
    };

    const machineCredentials = createMachineCredentialStore({
      databasePath: temporaryDatabasePath,
    });
    try {
      const credential = machineCredentials.create({
        machineId: PILOT_MACHINE_ID,
        projectIds: [seed.project.id],
      });
      writeFileSync(temporaryTokenPath, `${credential.token}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      chmodSync(temporaryTokenPath, 0o600);
    } finally {
      machineCredentials.close();
    }

    // Publish both artifacts only after the complete synthetic database and
    // credential have been created. Hard links fail if a concurrent process
    // created either final path, so an initializer failure cannot overwrite it.
    linkSync(temporaryTokenPath, options.tokenPath);
    publishedToken = true;
    linkSync(temporaryDatabasePath, options.databasePath);
    publishedDatabase = true;
  } catch (error) {
    if (publishedToken) removeIfPresent(options.tokenPath);
    if (publishedDatabase) removeIfPresent(options.databasePath);
    throw error;
  } finally {
    removeIfPresent(temporaryTokenPath);
    removeIfPresent(temporaryDatabasePath);
    removeIfPresent(`${temporaryDatabasePath}-wal`);
    removeIfPresent(`${temporaryDatabasePath}-shm`);
  }

  if (!seedIds)
    throw new Error("Pilot initialization did not produce seed IDs.");
  process.stdout.write(
    `${JSON.stringify({
      databasePath: options.databasePath,
      machineId: PILOT_MACHINE_ID,
      machineTokenFile: options.tokenPath,
      projectId: seedIds.projectId,
      subtaskIds: seedIds.subtaskIds,
      taskId: seedIds.taskId,
    })}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
