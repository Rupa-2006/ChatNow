import { io, type Socket } from 'socket.io-client';
import { getAccessToken, onTokenRefreshed, performSilentRefresh } from './http';

export type SocketAck<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

let socket: Socket | null = null;
let connectedToken: string | null = null;

export function getSocket(): Socket | null {
  return socket;
}

/**
 * Opens or returns the authenticated WebSocket connection.
 * WebSocket-only matches backend/src/sockets/index.ts so Nginx round-robin works cleanly.
 */
export function connectSocket(): Socket {
  const token = getAccessToken();
  if (socket && connectedToken === token) {
    if (!socket.connected) socket.connect();
    return socket;
  }

  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  connectedToken = token;
  const socketOrigin =
    (import.meta.env.VITE_SOCKET_ORIGIN as string | undefined) || window.location.origin;
  socket = io(socketOrigin, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: (cb) => {
      cb({ token: getAccessToken() });
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 15_000,
  });

  // If handshake fails because the short-lived JWT expired, refresh over REST and reconnect.
  socket.on('connect_error', async (err) => {
    if (err.message === 'UNAUTHENTICATED') {
      const next = await performSilentRefresh();
      if (next && socket) {
        connectedToken = next;
        socket.connect();
      }
    }
  });

  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    connectedToken = null;
  }
}

export function emitWithAck<T = undefined>(
  event: string,
  payload: unknown,
  timeoutMs = 10_000,
): Promise<SocketAck<T>> {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) {
      resolve({ ok: false, error: { code: 'DISCONNECTED', message: 'Not connected to messaging server' } });
      return;
    }

    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: { code: 'TIMEOUT', message: 'Server did not acknowledge in time' } });
    }, timeoutMs);

    socket.emit(event, payload, (response: SocketAck<T>) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(response);
    });
  });
}

// Push refreshed access tokens over live sockets before the old JWT expires.
onTokenRefreshed((token) => {
  connectedToken = token;
  if (socket?.connected) {
    socket.emit('auth:refresh', { token });
  }
});

/** Displays a browser Notification when permission is granted and the tab is in the background. */
export function showBrowserNotification(title: string, body: string): void {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;

  try {
    const n = new Notification(title, {
      body,
      icon: '/favicon.svg',
      silent: false,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Ignore browser notification restrictions
  }
}
