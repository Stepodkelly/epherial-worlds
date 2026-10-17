export function watchUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/room`;
}

let publishSocket = null;
let publishReady = false;
let pendingState;
let retryAt = 0;

function ignore() {}

function openPublisher() {
  publishReady = false;
  const socket = new WebSocket(watchUrl());
  publishSocket = socket;
  socket.addEventListener('error', ignore);
  socket.addEventListener('open', () => {
    if (publishSocket !== socket) return;
    try {
      publishReady = true;
      socket.send(JSON.stringify({ role: 'publish' }));
      if (pendingState !== undefined) {
        const state = pendingState;
        pendingState = undefined;
        socket.send(JSON.stringify(state));
      }
    } catch {
      ignore();
    }
  });
  socket.addEventListener('close', () => {
    if (publishSocket !== socket) return;
    publishSocket = null;
    if (!publishReady) retryAt = Date.now() + 4000;
    publishReady = false;
  });
}

export function publishRoom(state) {
  try {
    const dead = !publishSocket
      || publishSocket.readyState === WebSocket.CLOSING
      || publishSocket.readyState === WebSocket.CLOSED;
    if (dead) {
      pendingState = state;
      if (Date.now() < retryAt) return;
      openPublisher();
    }
    if (publishSocket.readyState === WebSocket.OPEN && publishReady) {
      publishSocket.send(JSON.stringify(state));
    } else {
      pendingState = state;
    }
  } catch {
    ignore();
  }
}

export function startWatch(onState) {
  const socket = new WebSocket(watchUrl());
  socket.addEventListener('open', () => {
    try {
      socket.send(JSON.stringify({ role: 'watch' }));
    } catch {
      ignore();
    }
  });
  socket.addEventListener('message', (event) => {
    let state;
    try {
      const text = typeof event.data === 'string' ? event.data : String(event.data);
      state = JSON.parse(text);
    } catch {
      return;
    }
    if (!state || typeof state !== 'object' || Array.isArray(state)) return;
    onState(state);
  });
  return socket;
}
