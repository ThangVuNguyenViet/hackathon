interface DashboardSocketState {
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): Array<{ send(message: string): void }>;
}

declare const WebSocketPair: {
  new (): { 0: WebSocket; 1: WebSocket };
};

export class DashboardSocket {
  constructor(
    private readonly state: DashboardSocketState,
    _env: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'POST') {
      const event = await request.text();
      for (const socket of this.state.getWebSockets()) {
        try {
          socket.send(event);
        } catch {
          // A disconnected monitor must not prevent delivery to other clients.
        }
      }
      return new Response(null, { status: 202 });
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    return new Response(null, {
      status: 101,
      webSocket: client,
    } as ResponseInit);
  }
}
