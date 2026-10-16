import { createHash } from "node:crypto";
import { z } from "zod";

export type T3RecentMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
};

export type T3Messaging = {
  readMessages(input: { threadId: string }): Promise<{
    messages: T3RecentMessage[];
    canSend: boolean;
    warning?: string;
  }>;
  sendMessage(input: {
    threadId: string;
    text: string;
    requestId: string;
  }): Promise<{
    threadId: string;
    messageId: string;
    delivery: string;
  }>;
};

const messageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]),
  text: z.string(),
  createdAt: z.string().datetime({ offset: true }),
});
const boundedSchema = z.object({
  payloadBudgetExceeded: z.boolean().optional(),
  projection: z.object({
    thread: z.object({ id: z.string() }),
    messages: z.array(messageSchema),
  }),
});
type MessageSocket = Pick<WebSocket, "addEventListener" | "send" | "close">;

/** Narrow control seam: recent text and an explicit human reply, never a generic proxy. */
export function createT3Messaging(input: {
  baseUrl?: string;
  token?: string;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  maxResponseBytes?: number;
  socketFactory?: (
    url: string,
    headers: Record<string, string>,
  ) => MessageSocket;
}): T3Messaging {
  const fetcher = input.fetcher ?? fetch;
  const timeoutMs = input.timeoutMs ?? 10_000;
  const maxBytes = input.maxResponseBytes ?? 8 * 1024 * 1024;
  const baseUrl = input.baseUrl?.replace(/\/$/, "");
  const token = input.token?.trim();

  async function request(path: string, init: RequestInit = {}) {
    if (!baseUrl || !token)
      throw new Error(
        "Configure this T3 connection before reading or sending messages.",
      );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(`${baseUrl}${path}`, {
        ...init,
        redirect: "error",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, ...init.headers },
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401)
          throw new Error(
            "T3 rejected this connection credential. Update it in Connections.",
          );
        if (response.status === 403)
          throw new Error(
            "T3 denied this operation. Reading messages requires orchestration:read; sending replies requires orchestration:operate.",
          );
        throw new Error(`T3 message request returned HTTP ${response.status}.`);
      }
      if (!response.body) return { response, body: "" };
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > maxBytes)
            throw new Error("T3 message response exceeded the size limit.");
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      return { response, body: Buffer.concat(chunks).toString("utf8") };
    } catch (error) {
      // Never forward network errors containing endpoints, headers, or credentials.
      if (
        error instanceof Error &&
        /^(T3 |This T3 |Configure this T3)/.test(error.message)
      )
        throw error;
      throw new Error(
        "T3 messages are unavailable. Check the connection and retry.",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async readMessages({ threadId }) {
      if (!threadId.trim()) throw new Error("T3 thread ID is required.");
      const result = await request(
        `/api/orchestration/threads/${encodeURIComponent(threadId)}/bounded?compactTurnItems=1`,
        {
          headers: { "x-t3-orchestration-protocol": "2" },
        },
      );
      let parsed: z.infer<typeof boundedSchema>;
      try {
        parsed = boundedSchema.parse(JSON.parse(result.body));
      } catch {
        throw new Error("T3 returned an invalid recent-message snapshot.");
      }
      if (parsed.projection.thread.id !== threadId) {
        throw new Error(
          "T3 returned an incomplete or mismatched recent-message snapshot.",
        );
      }
      const messages = parsed.projection.messages
        .filter((message) => message.threadId === threadId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(-6)
        .map(({ id, role, text, createdAt }) => ({
          id,
          role,
          text: text.slice(0, 20_000),
          createdAt,
        }));
      let canSend = false;
      try {
        const session = JSON.parse((await request("/api/auth/session")).body);
        canSend =
          session.authenticated === true &&
          (session.permissions ?? session.scopes ?? []).includes(
            "orchestration:operate",
          );
      } catch {
        /* Recent messages remain useful with a read-only credential. */
      }
      return {
        messages,
        canSend,
        ...(parsed.payloadBudgetExceeded
          ? {
              warning:
                "T3 limited this thread snapshot. Showing the available recent messages.",
            }
          : {}),
      };
    },
    async sendMessage({ threadId, text, requestId }) {
      if (
        !threadId.trim() ||
        !text.trim() ||
        text.length > 50_000 ||
        !/^[A-Za-z0-9._-]{8,128}$/.test(requestId)
      ) {
        throw new Error(
          "T3 replies require a thread, message, and stable request ID.",
        );
      }
      const authResult = await request("/api/auth/session");
      let session: {
        authenticated?: boolean;
        permissions?: string[];
        scopes?: string[];
      };
      try {
        session = JSON.parse(authResult.body);
      } catch {
        throw new Error("T3 returned an invalid permission snapshot.");
      }
      if (
        !session.authenticated ||
        !(session.permissions ?? session.scopes ?? []).includes(
          "orchestration:operate",
        )
      ) {
        throw new Error(
          "This T3 credential needs orchestration:operate permission to send replies.",
        );
      }
      const key = createHash("sha256")
        .update(JSON.stringify([threadId, requestId]))
        .digest("hex");
      const commandId = `factory:reply:${key}`;
      const messageId = `factory:message:${key}`;
      const endpoint = new URL(`${baseUrl}/ws`);
      endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
      endpoint.searchParams.set("orchestrationProtocol", "2");
      const socketFactory =
        input.socketFactory ??
        ((url, headers) => {
          const Socket = WebSocket as unknown as new (
            url: string,
            options: { headers: Record<string, string> },
          ) => WebSocket;
          return new Socket(url, { headers });
        });
      // Use the supported environment WebSocket command. Environment bearer tokens and
      // MCP OAuth tokens have different audiences; they cannot be interchanged.
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let socket: MessageSocket | undefined;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            socket?.close();
          } catch {
            /* The socket may already be gone. */
          }
          if (error) reject(error);
          else resolve();
        };
        const timer = setTimeout(
          () =>
            finish(
              new Error(
                "T3 did not confirm reply delivery. Retry the unchanged message safely.",
              ),
            ),
          timeoutMs,
        );
        try {
          socket = socketFactory(endpoint.toString(), {
            Authorization: `Bearer ${token}`,
          });
          socket.addEventListener("open", () => {
            try {
              socket!.send(
                JSON.stringify({
                  _tag: "Request",
                  id: "1",
                  tag: "orchestration.dispatchCommand",
                  headers: [],
                  payload: {
                    type: "message.dispatch",
                    commandId,
                    threadId,
                    messageId,
                    text,
                    attachments: [],
                    createdBy: "user",
                    creationSource: "web",
                    dispatchMode: { type: "queue_after_active" },
                  },
                }),
              );
            } catch {
              finish(
                new Error(
                  "T3 closed before accepting the reply. Retry the unchanged message safely.",
                ),
              );
            }
          });
          socket.addEventListener("message", (event) => {
            try {
              const raw = String((event as MessageEvent).data);
              if (Buffer.byteLength(raw) > maxBytes) throw new Error();
              const decoded = JSON.parse(raw);
              for (const response of Array.isArray(decoded)
                ? decoded
                : [decoded]) {
                if (response._tag !== "Exit" || response.requestId !== "1")
                  continue;
                if (
                  response.exit?._tag !== "Success" ||
                  !Number.isSafeInteger(response.exit.value?.sequence) ||
                  response.exit.value.sequence < 0
                ) {
                  finish(
                    new Error(
                      "T3 rejected this reply. Check thread availability and connection permissions before retrying.",
                    ),
                  );
                } else finish();
              }
            } catch {
              finish(
                new Error(
                  "T3 returned an invalid reply receipt. Retry the unchanged message safely.",
                ),
              );
            }
          });
          socket.addEventListener("error", () =>
            finish(
              new Error(
                "T3 replies are unavailable. Check the connection and retry the unchanged message.",
              ),
            ),
          );
          socket.addEventListener("close", () => {
            if (!settled)
              finish(
                new Error(
                  "T3 closed before confirming reply delivery. Retry the unchanged message safely.",
                ),
              );
          });
        } catch {
          finish(
            new Error(
              "T3 replies are unavailable. Check the connection and retry the unchanged message.",
            ),
          );
        }
      });
      return { threadId, messageId, delivery: "accepted" };
    },
  };
}
