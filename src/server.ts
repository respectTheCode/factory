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
        .input(z.object({ name: z.string().min(1) }))
        .mutation(({ input }) => application.createProject(input)),
      list: trpc.procedure.query(() => application.listProjects()),
      detail: trpc.procedure
        .input(z.object({ projectId: z.string().min(1) }))
        .query(({ input }) => application.getProjectHierarchy(input.projectId)),
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
        .input(z.object({ name: z.string().min(1), taskId: z.string().min(1) }))
        .mutation(({ input }) => {
          const subtask = application.createSubtask(input);
          projectUpdates.publishAll();
          return subtask;
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
          z.object({ name: z.string().min(1), projectId: z.string().min(1) }),
        )
        .mutation(({ input }) => {
          const task = application.createTask(input);
          projectUpdates.publish(input.projectId);
          return task;
        }),
      status: trpc.procedure
        .input(z.object({ taskId: z.string().min(1) }))
        .query(({ input }) => application.getTaskStatus(input.taskId)),
      detail: trpc.procedure
        .input(z.object({ taskId: z.string().min(1) }))
        .query(({ input }) => application.getTaskDetail(input.taskId)),
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
  port,
}: {
  databasePath?: string;
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
    hostname: "127.0.0.1",
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
  const server = createFactoryServer({ port: 3000 });
  console.info(`Software Factory listening at ${server.url}`);
}
