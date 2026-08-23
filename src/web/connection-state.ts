export type ConnectionSnapshot = {
  canMutate: boolean;
  lastSuccessfulConnection: Date | null;
  state: "connected" | "connecting" | "reconnecting" | "disconnected";
};

export class ConnectionState {
  private lastSuccessfulConnection: Date | null = null;
  private state: ConnectionSnapshot["state"] = "connecting";
  private canMutate = false;

  markConnected(at: Date): void {
    const reconnecting = this.lastSuccessfulConnection !== null;
    this.lastSuccessfulConnection = at;
    this.state = "connected";
    this.canMutate = !reconnecting;
  }

  markDisconnected(): void {
    this.state = "disconnected";
    this.canMutate = false;
  }

  markAuthoritativeRefresh(): void {
    if (this.state === "connected") {
      this.canMutate = true;
    }
  }

  snapshot(): ConnectionSnapshot {
    return {
      canMutate: this.canMutate,
      lastSuccessfulConnection: this.lastSuccessfulConnection,
      state: this.state,
    };
  }
}
