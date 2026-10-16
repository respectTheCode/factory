import { describe, expect, test } from "bun:test";
import { createT3Messaging } from "../src/t3-messages";

describe("T3 issue messages", () => {
  test("fails closed for read-only credentials, early close, and missing receipts", async () => {
    let connected = false;
    const readOnly = createT3Messaging({
      baseUrl: "http://127.0.0.1:3773",
      token: "token",
      fetcher: async () =>
        Response.json({
          authenticated: true,
          permissions: ["orchestration:read"],
        }),
      socketFactory: () => {
        connected = true;
        throw new Error("must not connect");
      },
    });
    const reply = {
      threadId: "thread-a",
      text: "Continue",
      requestId: "request-123",
    };
    await expect(readOnly.sendMessage(reply)).rejects.toThrow(
      "orchestration:operate",
    );
    expect(connected).toBe(false);
    for (const earlyClose of [true, false]) {
      class Socket extends EventTarget {
        closed = false;
        constructor() {
          super();
          queueMicrotask(() => this.dispatchEvent(new Event("open")));
        }
        send() {
          if (earlyClose)
            queueMicrotask(() => this.dispatchEvent(new Event("close")));
        }
        close() {
          this.closed = true;
        }
      }
      let socket: Socket | undefined;
      const client = createT3Messaging({
        baseUrl: "http://127.0.0.1:3773",
        token: "token",
        timeoutMs: 10,
        fetcher: async () =>
          Response.json({
            authenticated: true,
            permissions: ["orchestration:operate"],
          }),
        socketFactory: () => (socket = new Socket()),
      });
      await expect(client.sendMessage(reply)).rejects.toThrow(
        earlyClose ? "closed before confirming" : "did not confirm",
      );
      expect(socket?.closed).toBe(true);
    }
  });

  test("reads the recent bounded messages and checks operate permission without exposing credentials", async () => {
    const requests: string[] = [];
    const client = createT3Messaging({
      baseUrl: "http://127.0.0.1:3773",
      token: "private-token",
      fetcher: async (url, options) => {
        requests.push(String(url));
        expect(new Headers(options?.headers).get("authorization")).toBe(
          "Bearer private-token",
        );
        if (String(url).endsWith("/session"))
          return Response.json({
            authenticated: true,
            permissions: ["orchestration:read"],
          });
        expect(
          new Headers(options?.headers).get("x-t3-orchestration-protocol"),
        ).toBe("2");
        return Response.json({
          projection: {
            thread: { id: "thread-a" },
            messages: Array.from({ length: 9 }, (_, i) => ({
              id: `m${i}`,
              threadId: "thread-a",
              role: i % 2 ? "assistant" : "user",
              text: `Message ${i}`,
              createdAt: `2026-10-16T12:00:0${i}Z`,
            })),
          },
        });
      },
    });
    const result = await client.readMessages({ threadId: "thread-a" });
    expect(result.messages.map((m) => m.id)).toEqual([
      "m3",
      "m4",
      "m5",
      "m6",
      "m7",
      "m8",
    ]);
    expect(result.canSend).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(requests).toHaveLength(2);
  });

  test("sends through the supported environment WebSocket with stable command IDs", async () => {
    const commands: any[] = [];
    let closed = 0;
    class Socket extends EventTarget {
      constructor() {
        super();
        queueMicrotask(() => this.dispatchEvent(new Event("open")));
      }
      send(text: string) {
        commands.push(JSON.parse(text));
        queueMicrotask(() =>
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                _tag: "Exit",
                requestId: "1",
                exit: { _tag: "Success", value: { sequence: 12 } },
              }),
            }),
          ),
        );
      }
      close() {
        closed++;
        this.dispatchEvent(new Event("close"));
      }
    }
    const client = createT3Messaging({
      baseUrl: "http://127.0.0.1:3773",
      token: "token",
      fetcher: async () =>
        Response.json({
          authenticated: true,
          permissions: ["orchestration:read", "orchestration:operate"],
        }),
      socketFactory: (url, headers) => {
        expect(url).toBe("ws://127.0.0.1:3773/ws?orchestrationProtocol=2");
        expect(headers.Authorization).toBe("Bearer token");
        return new Socket();
      },
    });
    const reply = {
      threadId: "thread-a",
      text: "Please continue",
      requestId: "request-123",
    };
    expect((await client.sendMessage(reply)).delivery).toBe("accepted");
    await client.sendMessage(reply);
    expect(commands[0]).toEqual(commands[1]);
    expect(commands[0].tag).toBe("orchestration.dispatchCommand");
    expect(commands[0].payload).toMatchObject({
      type: "message.dispatch",
      threadId: "thread-a",
      text: "Please continue",
      dispatchMode: { type: "queue_after_active" },
      createdBy: "user",
    });
    expect(closed).toBe(2);
  });

  test("requires a successful matching receipt and preserves an uncertain delivery for safe retry", async () => {
    class Socket extends EventTarget {
      constructor(readonly success: boolean) {
        super();
        queueMicrotask(() => this.dispatchEvent(new Event("open")));
      }
      send() {
        queueMicrotask(() =>
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                _tag: "Exit",
                requestId: "1",
                exit: this.success
                  ? { _tag: "Success", value: { sequence: -1 } }
                  : {
                      _tag: "Failure",
                      cause: [
                        { _tag: "Fail", error: { secret: "never leak" } },
                      ],
                    },
              }),
            }),
          ),
        );
      }
      close() {}
    }
    for (const malformed of [true, false]) {
      const client = createT3Messaging({
        baseUrl: "http://127.0.0.1:3773",
        token: "token",
        fetcher: async () =>
          Response.json({
            authenticated: true,
            scopes: ["orchestration:operate"],
          }),
        socketFactory: () => new Socket(malformed),
      });
      await expect(
        client.sendMessage({
          threadId: "thread-a",
          text: "Continue",
          requestId: "request-123",
        }),
      ).rejects.toThrow("T3 rejected this reply");
    }
  });

  test("does not report success for rejected, malformed, mismatched, or oversized responses", async () => {
    for (const payload of [
      { projection: { thread: { id: "other" }, messages: [] } },
      {
        projection: { thread: { id: "thread-a" }, messages: [{ text: "bad" }] },
      },
    ]) {
      const client = createT3Messaging({
        baseUrl: "http://127.0.0.1:3773",
        token: "token",
        fetcher: async () => Response.json(payload),
      });
      await expect(
        client.readMessages({ threadId: "thread-a" }),
      ).rejects.toThrow();
    }
    const client = createT3Messaging({
      baseUrl: "http://127.0.0.1:3773",
      token: "token",
      maxResponseBytes: 32,
      fetcher: async () => new Response("x".repeat(33)),
    });
    await expect(client.readMessages({ threadId: "thread-a" })).rejects.toThrow(
      "size limit",
    );
    const denied = createT3Messaging({
      baseUrl: "http://127.0.0.1:3773",
      token: "secret",
      fetcher: async () => new Response("secret", { status: 403 }),
    });
    await expect(
      denied.sendMessage({
        threadId: "thread-a",
        text: "Continue",
        requestId: "request-123",
      }),
    ).rejects.toThrow("orchestration:operate");
  });

  test("shows valid available message text with an explicit snapshot-budget warning", async () => {
    const client = createT3Messaging({
      baseUrl: "http://127.0.0.1:3773",
      token: "token",
      fetcher: async (url) =>
        String(url).endsWith("/session")
          ? Response.json({
              authenticated: true,
              permissions: ["orchestration:read", "orchestration:operate"],
            })
          : Response.json({
              payloadBudgetExceeded: true,
              projection: {
                thread: { id: "thread-a" },
                messages: [
                  {
                    id: "m1",
                    threadId: "thread-a",
                    role: "assistant",
                    text: "Available recent message",
                    createdAt: "2026-10-16T12:00:00Z",
                  },
                ],
              },
            }),
    });
    const result = await client.readMessages({ threadId: "thread-a" });
    expect(result.messages[0]?.text).toBe("Available recent message");
    expect(result.warning).toContain("limited this thread snapshot");
    expect(result.canSend).toBe(true);
  });
});
