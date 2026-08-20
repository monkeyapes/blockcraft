/**
 * Transport abstraction.
 *
 * Multiplayer and single-player speak the identical protocol; the only
 * difference is whether messages cross a socket or a function call. That
 * keeps one code path for world edits, validation and persistence.
 */

import type { ClientMessage, ServerMessage } from '@shared/protocol.js';

export interface Link {
  readonly connected: boolean;
  send(msg: ClientMessage): void;
  onMessage(cb: (msg: ServerMessage) => void): void;
  onStatus(cb: (text: string) => void): void;
  close(): void;
}

export class WebSocketLink implements Link {
  private socket: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private messageCb: (msg: ServerMessage) => void = () => {};
  private statusCb: (text: string) => void = () => {};
  private reconnectDelay = 1000;
  private closed = false;

  connected = false;

  constructor(readonly url: string) {
    this.connect();
  }

  private connect(): void {
    this.statusCb(`Connecting to ${this.url}...`);
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch (err) {
      this.statusCb(`Bad server address: ${String(err)}`);
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      this.statusCb('Connected.');
      for (const msg of this.queue) socket.send(JSON.stringify(msg));
      this.queue.length = 0;
    });

    socket.addEventListener('message', (event) => {
      try {
        this.messageCb(JSON.parse(String(event.data)) as ServerMessage);
      } catch {
        /* ignore malformed frames */
      }
    });

    socket.addEventListener('close', () => {
      this.connected = false;
      this.socket = null;
      if (this.closed) return;
      this.statusCb(`Disconnected. Retrying in ${Math.round(this.reconnectDelay / 1000)}s...`);
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000);
    });

    socket.addEventListener('error', () => this.statusCb('Connection error.'));
  }

  send(msg: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
    else if (this.queue.length < 512) this.queue.push(msg);
  }

  onMessage(cb: (msg: ServerMessage) => void): void {
    this.messageCb = cb;
  }

  onStatus(cb: (text: string) => void): void {
    this.statusCb = cb;
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
  }
}
