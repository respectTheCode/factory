export type ConnectionSnapshot = {
  canMutate: boolean;
  lastSuccessfulConnection: Date | null;
  state: "connected" | "connecting" | "reconnecting";
};

export class ConnectionState {
  private lastSuccessfulConnection: Date | null = null;
  private state: ConnectionSnapshot["state"] = "connecting";

  markConnected(at: Date): void {
    this.lastSuccessfulConnection = at;
    this.state = "connected";
  }

  markDisconnected(): void {
    this.state = "reconnecting";
  }

  snapshot(): ConnectionSnapshot {
    return {
      canMutate: this.state === "connected",
      lastSuccessfulConnection: this.lastSuccessfulConnection,
      state: this.state,
    };
  }
}
