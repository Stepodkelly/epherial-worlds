import http from 'node:http';

const ROOM_ID = 'floor';

let WebSocket;
let WebSocketServer;
try {
  ({ WebSocket, WebSocketServer } = await import('ws'));
} catch {
  WebSocket = null;
  WebSocketServer = null;
}

function requireWs() {
  if (!WebSocketServer || !WebSocket) throw new Error('ws missing');
}

function roomPath(request) {
  try {
    return new URL(request.url ?? '', 'http://127.0.0.1').pathname;
  } catch {
    return '';
  }
}

function sendText(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(payload);
  } catch {
    // A watcher can close between the readyState check and the write.
  }
}

// One in-memory room, id "floor". Publishers replace its state.
// Watchers get the latest text frame on hello, then each later update.
export function attachRoom(httpServer) {
  requireWs();

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });
  const room = { latest: null, watchers: new Set() };
  const rooms = new Map([[ROOM_ID, room]]);

  httpServer.on('upgrade', (request, socket, head) => {
    if (roomPath(request) !== '/room') return;
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    const floor = rooms.get(ROOM_ID);
    let role = '';

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const text = typeof data === 'string' ? data : data.toString();
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }

      if (!role) {
        if (!msg || (msg.role !== 'publish' && msg.role !== 'watch')) return;
        role = msg.role;
        if (role === 'watch') {
          floor.watchers.add(ws);
          if (floor.latest !== null) sendText(ws, floor.latest);
        }
        return;
      }

      if (role !== 'publish') return;
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
      floor.latest = text;
      for (const watcher of floor.watchers) sendText(watcher, text);
    });

    ws.on('close', () => {
      floor.watchers.delete(ws);
    });
  });

  return wss;
}

// Listens only when called. The smoke test is the caller.
export function start(port) {
  requireWs();
  const server = http.createServer((req, res) => {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });
  attachRoom(server);
  return new Promise((resolve, reject) => {
    const fail = (error) => reject(error);
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', fail);
      resolve(server);
    });
  });
}
