import { Buffer } from "node:buffer";

import { getWSConnectionHandler } from "@trpc/server/adapters/ws";
import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";

import { createFactoryApplication, type ProjectHierarchy } from "./application";

type ConnectionEvent = "close" | "error" | "message";
type ConnectionListener = (...args: unknown[]) => void;

type SocketData = {
  listeners: Map<ConnectionEvent, Set<ConnectionListener>>;
  request: Request;
};

export type FactoryServer = {
  stop: () => void;
  url: URL;
};

const trpc = initTRPC.create();

class ProjectUpdateBus {
  private readonly listeners = new Map<
    string,
    Set<(detail: ProjectHierarchy) => void>
  >();

  constructor(
    private readonly application: ReturnType<typeof createFactoryApplication>,
  ) {}

  subscribe(
    projectId: string,
    listener: (detail: ProjectHierarchy) => void,
  ): () => void {
    const listeners = this.listeners.get(projectId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(projectId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(projectId);
    };
  }

  publish(projectId: string): void {
    const detail = this.application.getProjectHierarchy(projectId);
    this.listeners.get(projectId)?.forEach((listener) => listener(detail));
  }

  publishAll(): void {
    this.application.listProjects().forEach(({ id }) => this.publish(id));
  }
}

function createRouter(
  application: ReturnType<typeof createFactoryApplication>,
) {
  const projectUpdates = new ProjectUpdateBus(application);

  return trpc.router({
    projects: trpc.router({
      create: trpc.procedure
        .input(
          z.object({
            gitOriginUrl: z.string().trim().min(1).optional(),
            name: z.string().min(1),
          }),
        )
        .mutation(({ input }) => application.createProject(input)),
      update: trpc.procedure
        .input(
          z.object({
            gitOriginUrl: z.string().trim().min(1).nullable(),
            projectId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          const project = application.updateProject(input);
          projectUpdates.publish(input.projectId);
          return project;
        }),
      remove: trpc.procedure
        .input(
          z.object({
            confirm: z.literal(true),
            projectId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          application.removeProject(input.projectId);
          projectUpdates.publishAll();
          return { projectId: input.projectId };
        }),
      link: trpc.procedure
        .input(
          z.object({
            projectId: z.string().min(1),
            stableId: z.string().min(1),
            system: z.enum(["linear", "notion"]),
            title: z.string().optional(),
            url: z.string().url(),
          }),
        )
        .mutation(({ input }) => {
          const link = application.addProjectTrackerLink(input);
          projectUpdates.publish(input.projectId);
          return link;
        }),
      list: trpc.procedure.query(() => application.listProjects()),
      attention: trpc.procedure.query(() =>
        application.getAttentionProjection(),
      ),
      portfolio: trpc.procedure.query(() => application.getPortfolioStatus()),
      status: trpc.procedure
        .input(z.object({ projectId: z.string().min(1) }))
        .query(({ input }) => application.getProjectStatus(input.projectId)),
      detail: trpc.procedure
        .input(z.object({ projectId: z.string().min(1) }))
        .query(({ input }) => ({
          ...application.getProjectHierarchy(input.projectId),
          trackerLinks: application.getProjectDetail(input.projectId)
            .trackerLinks,
        })),
      updates: trpc.procedure
        .input(z.object({ projectId: z.string().min(1) }))
        .subscription(({ input }) =>
          observable<ProjectHierarchy>((emit) =>
            projectUpdates.subscribe(input.projectId, (detail) =>
              emit.next(detail),
            ),
          ),
        ),
    }),
    subtasks: trpc.router({
      create: trpc.procedure
        .input(
          z.object({
            description: z.string().optional(),
            name: z.string().min(1),
            taskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          const subtask = application.createSubtask(input);
          projectUpdates.publishAll();
          return subtask;
        }),
      remove: trpc.procedure
        .input(
          z.object({
            confirm: z.literal(true),
            subtaskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          application.removeSubtask(input.subtaskId);
          projectUpdates.publishAll();
          return { subtaskId: input.subtaskId };
        }),
      report: trpc.procedure
        .input(
          z.object({
            evidence: z.string().optional(),
            reportedState: z.enum([
              "not_started",
              "in_progress",
              "blocked",
              "complete",
            ]),
            reporter: z.string().min(1),
            subtaskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          const report = application.reportSubtaskStatus(input);
          projectUpdates.publishAll();
          return report;
        }),
      archive: trpc.procedure
        .input(
          z.object({
            archiveState: z.enum(["released", "wont_do"]),
            subtaskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          application.archiveSubtask(input.subtaskId, input.archiveState);
          projectUpdates.publishAll();
          return {
            archiveState: input.archiveState,
            subtaskId: input.subtaskId,
          };
        }),
      restore: trpc.procedure
        .input(z.object({ subtaskId: z.string().min(1) }))
        .mutation(({ input }) => {
          application.restoreSubtask(input.subtaskId);
          projectUpdates.publishAll();
          return { subtaskId: input.subtaskId };
        }),
      verify: trpc.procedure
        .input(
          z.object({
            decision: z.enum(["accepted", "rejected", "deferred"]),
            reportId: z.string().min(1),
            verifier: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          application.verifyStatusReport(input);
          projectUpdates.publishAll();
          return { ok: true };
        }),
      history: trpc.procedure
        .input(z.object({ subtaskId: z.string().min(1) }))
        .query(({ input }) =>
          application.getSubtaskReportHistory(input.subtaskId),
        ),
      verifications: trpc.procedure
        .input(z.object({ subtaskId: z.string().min(1) }))
        .query(({ input }) =>
          application.getSubtaskVerificationHistory(input.subtaskId),
        ),
    }),
    tasks: trpc.router({
      create: trpc.procedure
        .input(
          z.object({
            acceptanceCriteria: z.array(z.string()).default([]),
            branchName: z.string().trim().min(1).optional(),
            dependencies: z.array(z.string()).default([]),
            name: z.string().min(1),
            objective: z.string().optional(),
            owner: z.string().optional(),
            priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
            projectId: z.string().min(1),
            repositoryLinks: z.array(z.string().url()).default([]),
          }),
        )
        .mutation(({ input }) => {
          const task = application.createTask(input);
          projectUpdates.publish(input.projectId);
          return task;
        }),
      remove: trpc.procedure
        .input(
          z.object({
            confirm: z.literal(true),
            taskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          application.removeTask(input.taskId);
          projectUpdates.publishAll();
          return { taskId: input.taskId };
        }),
      status: trpc.procedure
        .input(z.object({ taskId: z.string().min(1) }))
        .query(({ input }) => application.getTaskStatus(input.taskId)),
      detail: trpc.procedure
        .input(z.object({ taskId: z.string().min(1) }))
        .query(({ input }) => application.getTaskDetail(input.taskId)),
      update: trpc.procedure
        .input(
          z.object({
            branchName: z.string().trim().min(1).nullable(),
            taskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          const task = application.updateTask(input);
          projectUpdates.publish(task.projectId);
          return task;
        }),
      archive: trpc.procedure
        .input(
          z.object({
            archiveState: z.enum(["released", "wont_do"]),
            taskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          application.archiveTask(input.taskId, input.archiveState);
          projectUpdates.publishAll();
          return {
            archiveState: input.archiveState,
            taskId: input.taskId,
          };
        }),
      restore: trpc.procedure
        .input(z.object({ taskId: z.string().min(1) }))
        .mutation(({ input }) => {
          application.restoreTask(input.taskId);
          projectUpdates.publishAll();
          return { taskId: input.taskId };
        }),
      link: trpc.procedure
        .input(
          z.object({
            system: z.enum(["linear", "notion"]),
            stableId: z.string().min(1),
            taskId: z.string().min(1),
            title: z.string().optional(),
            url: z.string().url(),
          }),
        )
        .mutation(({ input }) => {
          const link = application.addTaskTrackerLink(input);
          projectUpdates.publishAll();
          return link;
        }),
    }),
  });
}

export type FactoryRouter = ReturnType<typeof createRouter>;

export function createFactoryServer({
  databasePath = "factory.sqlite",
  hostname = "127.0.0.1",
  port,
}: {
  databasePath?: string;
  hostname?: string;
  port: number;
}): FactoryServer {
  const application = createFactoryApplication({ databasePath });
  const router = createRouter(application);
  const onConnection = getWSConnectionHandler({
    createContext: () => ({}),
    router,
    wss: undefined as never,
  });

  const server = Bun.serve<SocketData>({
    hostname,
    port,
    fetch(request, bunServer) {
      const url = new URL(request.url);

      if (url.pathname === "/trpc") {
        const upgraded = bunServer.upgrade(request, {
          data: { listeners: new Map(), request },
        });

        if (upgraded) {
          return undefined;
        }
      }

      const staticFile = getStaticFile(url.pathname);
      if (staticFile) {
        return new Response(Bun.file(staticFile));
      }

      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(socket) {
        const url = new URL(socket.data.request.url);
        const request = {
          headers: {},
          url: `${url.pathname}${url.search}`,
        } as never;

        onConnection(createWebSocketAdapter(socket), request);
      },
      message(socket, message) {
        emit(socket.data, "message", toBuffer(message), false);
      },
      close(socket) {
        emit(socket.data, "close");
      },
    },
  });

  return server;
}

function getStaticFile(pathname: string): string | null {
  if (pathname.startsWith("/projects/")) {
    return "src/web/index.html";
  }

  const files: Record<string, string> = {
    "/": "src/web/index.html",
    "/icon.svg": "src/web/icon.svg",
    "/manifest.webmanifest": "src/web/manifest.webmanifest",
    "/main.css": "dist/main.css",
    "/main.js": "dist/main.js",
    "/service-worker.js": "dist/service-worker.js",
  };

  return files[pathname] ?? null;
}

function createWebSocketAdapter(socket: Bun.ServerWebSocket<SocketData>) {
  return {
    close: () => socket.close(),
    get readyState() {
      return socket.readyState;
    },
    on(event: ConnectionEvent, listener: ConnectionListener) {
      addListener(socket.data, event, listener);
      return this;
    },
    once(event: ConnectionEvent, listener: ConnectionListener) {
      const onceListener: ConnectionListener = (...args) => {
        socket.data.listeners.get(event)?.delete(onceListener);
        listener(...args);
      };
      addListener(socket.data, event, onceListener);
      return this;
    },
    send(data: string | Uint8Array) {
      socket.send(data);
    },
  } as never;
}

function addListener(
  data: SocketData,
  event: ConnectionEvent,
  listener: ConnectionListener,
): void {
  const listeners = data.listeners.get(event) ?? new Set<ConnectionListener>();
  listeners.add(listener);
  data.listeners.set(event, listeners);
}

function emit(
  data: SocketData,
  event: ConnectionEvent,
  ...args: unknown[]
): void {
  data.listeners.get(event)?.forEach((listener) => listener(...args));
}

function toBuffer(message: string | ArrayBuffer | Uint8Array): Buffer {
  if (typeof message === "string") {
    return Buffer.from(message);
  }

  return Buffer.from(new Uint8Array(message));
}

if (import.meta.main) {
  const server = createFactoryServer({
    hostname: Bun.env.FACTORY_HOST ?? "127.0.0.1",
    port: 3000,
  });
  console.info(`Software Factory listening at ${server.url}`);
}
