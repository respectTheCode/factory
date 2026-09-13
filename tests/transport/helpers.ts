import { createFactoryServer, type FactoryServer } from "../../src/server";

export const TEST_OPERATOR = {
  name: "test-operator",
  secret: "test-operator-secret",
};

export function createTestServer(
  options: Parameters<typeof createFactoryServer>[0],
): FactoryServer {
  return createFactoryServer({ operator: TEST_OPERATOR, ...options });
}

export async function loginTestOperator(
  server: Pick<FactoryServer, "url">,
): Promise<string> {
  const response = await fetch(new URL("/session/login", server.url), {
    body: JSON.stringify({ secret: TEST_OPERATOR.secret }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Test operator login failed: ${response.status}`);
  }
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Expected a session cookie.");
  return setCookie.split(";", 1)[0] ?? "";
}

export function createWebSocket(
  url: string | URL,
  headers: Record<string, string> = {},
): WebSocket {
  const BunWebSocket = WebSocket as unknown as new (
    url: string | URL,
    options?: { headers: Record<string, string> },
  ) => WebSocket;
  return new BunWebSocket(url, { headers });
}

export async function openAuthenticatedSocket(
  server: Pick<FactoryServer, "url">,
): Promise<WebSocket> {
  const socket = createWebSocket(new URL("/trpc", server.url), {
    Cookie: await loginTestOperator(server),
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("WebSocket connection failed")),
      { once: true },
    );
  });
  return socket;
}
