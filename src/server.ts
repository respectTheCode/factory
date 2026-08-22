import { Buffer } from "node:buffer";

import { getWSConnectionHandler } from "@trpc/server/adapters/ws";
import { initTRPC } from "@trpc/server";
import { z } from "zod";

import { createFactoryApplication } from "./application";

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
function createRouter(
  application: ReturnType<typeof createFactoryApplication>,
) {
  return trpc.router({
    projects: trpc.router({
      create: trpc.procedure
        .input(z.object({ name: z.string().min(1) }))
        .mutation(({ input }) => application.createProject(input)),
      list: trpc.procedure.query(() => application.listProjects()),
      detail: trpc.procedure
        .input(z.object({ projectId: z.string().min(1) }))
        .query(({ input }) => application.getProjectHierarchy(input.projectId)),
    }),
    subtasks: trpc.router({
      create: trpc.procedure
        .input(z.object({ name: z.string().min(1), taskId: z.string().min(1) }))
        .mutation(({ input }) => application.createSubtask(input)),
    }),
    tasks: trpc.router({
      create: trpc.procedure
        .input(
          z.object({ name: z.string().min(1), projectId: z.string().min(1) }),
        )
        .mutation(({ input }) => application.createTask(input)),
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
