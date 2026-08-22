import { describe, expect, test } from "bun:test";

import { ConnectionState } from "../../src/web/connection-state";

describe("connection state", () => {
  test("gates mutations while connecting or reconnecting", () => {
    const connection = new ConnectionState();
    const firstConnection = new Date("2026-08-22T12:00:00.000Z");
    const secondConnection = new Date("2026-08-22T12:05:00.000Z");

    expect(connection.snapshot()).toEqual({
      canMutate: false,
      lastSuccessfulConnection: null,
      state: "connecting",
    });

    connection.markConnected(firstConnection);

    expect(connection.snapshot()).toEqual({
      canMutate: true,
      lastSuccessfulConnection: firstConnection,
      state: "connected",
    });

    connection.markDisconnected();

    expect(connection.snapshot()).toEqual({
      canMutate: false,
      lastSuccessfulConnection: firstConnection,
      state: "reconnecting",
    });

    connection.markConnected(secondConnection);

    expect(connection.snapshot()).toEqual({
      canMutate: true,
      lastSuccessfulConnection: secondConnection,
      state: "connected",
    });
  });
});
