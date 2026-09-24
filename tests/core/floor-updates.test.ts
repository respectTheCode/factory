import { describe, expect, test } from "bun:test";

import { createFloorUpdateBus } from "../../src/floor-updates";
import type { FloorSnapshot } from "../../src/floor";

function snapshot(generatedAt: string): FloorSnapshot {
  return {
    connections: [],
    events: [],
    generatedAt,
    projects: [],
    queue: [],
    scoreboard: {
      reportsToday: 0,
      stampedToday: 0,
      workingNow: 0,
    },
    timezone: "America/Indiana/Indianapolis",
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Floor update bus", () => {
  test("coalesces invalidations during a refresh and does not lose the follow-up", async () => {
    const resolvers: Array<(value: FloorSnapshot) => void> = [];
    let calls = 0;
    const received: string[] = [];
    const secondReceived: string[] = [];
    const bus = createFloorUpdateBus({
      intervalMs: 60_000,
      refresh: () => {
        calls += 1;
        return new Promise<FloorSnapshot>((resolve) => resolvers.push(resolve));
      },
    });
    const unsubscribe = bus.subscribe((value) =>
      received.push(value.generatedAt),
    );
    const unsubscribeSecond = bus.subscribe((value) =>
      secondReceived.push(value.generatedAt),
    );
    await tick();
    expect(calls).toBe(1);

    bus.invalidate();
    bus.invalidate();
    resolvers.shift()!(snapshot("first"));
    await tick();
    expect(calls).toBe(2);
    resolvers.shift()!(snapshot("second"));
    await tick();
    expect(received).toEqual(["first", "second"]);
    expect(secondReceived).toEqual(["first", "second"]);

    unsubscribe();
    unsubscribeSecond();
    bus.stop();
  });

  test("surfaces unexpected refresh failures to each subscriber", async () => {
    const failure = new Error("reader failed");
    const errors: unknown[] = [];
    const bus = createFloorUpdateBus({
      intervalMs: 60_000,
      refresh: async () => {
        throw failure;
      },
    });
    const unsubscribe = bus.subscribe(
      () => undefined,
      (error) => errors.push(error),
    );
    await tick();
    expect(errors).toEqual([failure]);
    unsubscribe();
    bus.stop();
  });

  test("stops polling and suppresses an in-flight result after unsubscribe", async () => {
    let calls = 0;
    let resolveRefresh: ((value: FloorSnapshot) => void) | undefined;
    const bus = createFloorUpdateBus({
      intervalMs: 5,
      refresh: () => {
        calls += 1;
        return new Promise<FloorSnapshot>((resolve) => {
          resolveRefresh = resolve;
        });
      },
    });
    const received: FloorSnapshot[] = [];
    const unsubscribe = bus.subscribe((value) => received.push(value));
    await tick();
    expect(calls).toBe(1);
    unsubscribe();
    resolveRefresh!(snapshot("late"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received).toEqual([]);
    expect(calls).toBe(1);
    bus.stop();
  });
});
