const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".fnt": "text/plain; charset=utf-8"
};

const rooms = new Map();
const roomStreams = new Map();

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendEvent(roomId, event) {
  const listeners = roomStreams.get(roomId);
  if (!listeners) {
    return;
  }
  const chunk = `data: ${JSON.stringify(event)}\n\n`;
  listeners.forEach((res) => res.write(chunk));
}

function publicRoom(room) {
  return {
    id: room.id,
    mode: room.mode,
    maxPlayers: room.maxPlayers,
    hostId: room.hostId,
    started: room.started,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      slot: player.slot
    }))
  };
}

function nextSlot(mode, players) {
  const slots = mode === 3 ? ["p1", "p2", "p3"] : ["p1", "p2"];
  for (const slot of slots) {
    if (!players.some((player) => player.slot === slot)) {
      return slot;
    }
  }
  return null;
}

function randomId(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  while (result.length < length) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}

function ensureRoomCode() {
  let code = randomId(5);
  while (rooms.has(code)) {
    code = randomId(5);
  }
  return code;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2e6) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function serveFile(reqPath, res) {
  const safePath = path.normalize(reqPath === "/" ? "/index.html" : reqPath).replace(/^(\.\.[\/\\])+/, "");
  const fullPath = path.join(ROOT, safePath);
  if (!fullPath.startsWith(ROOT)) {
    json(res, 403, { error: "Forbidden" });
    return;
  }
  fs.readFile(fullPath, (error, data) => {
    if (error) {
      if (error.code === "ENOENT") {
        json(res, 404, { error: "Not found" });
        return;
      }
      json(res, 500, { error: "Failed to read file" });
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300"
    });
    res.end(data);
  });
}

function createRoom(name, mode) {
  const roomId = ensureRoomCode();
  const playerId = `player_${randomId(8)}`;
  const roomMode = mode === 3 ? 3 : 2;
  const room = {
    id: roomId,
    mode: roomMode,
    maxPlayers: roomMode === 3 ? 3 : 2,
    hostId: playerId,
    started: false,
    players: [
      {
        id: playerId,
        name: name || "Host",
        slot: "p1"
      }
    ],
    snapshot: null
  };
  rooms.set(roomId, room);
  return { room, playerId };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/healthz") {
    json(res, 200, {
      ok: true,
      service: "8ball-pool-online"
    });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/rooms/") && pathname.endsWith("/events")) {
    const roomId = pathname.split("/")[3];
    const room = rooms.get(roomId);
    if (!room) {
      json(res, 404, { error: "Room not found" });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });
    res.write(`data: ${JSON.stringify({ type: "room_state", room: publicRoom(room), snapshot: room.snapshot })}\n\n`);
    if (!roomStreams.has(roomId)) {
      roomStreams.set(roomId, new Set());
    }
    roomStreams.get(roomId).add(res);
    req.on("close", () => {
      const listeners = roomStreams.get(roomId);
      if (!listeners) {
        return;
      }
      listeners.delete(res);
      if (!listeners.size) {
        roomStreams.delete(roomId);
      }
    });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/rooms/")) {
    const roomId = pathname.split("/")[3];
    const room = rooms.get(roomId);
    if (!room) {
      json(res, 404, { error: "Room not found" });
      return;
    }
    json(res, 200, { room: publicRoom(room), snapshot: room.snapshot });
    return;
  }

  if (req.method === "POST" && pathname === "/api/create-room") {
    try {
      const body = await parseBody(req);
      const { room, playerId } = createRoom(body.name, Number(body.mode));
      json(res, 200, { room: publicRoom(room), playerId });
    } catch (error) {
      json(res, 400, { error: "Invalid request body" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/join-room") {
    try {
      const body = await parseBody(req);
      const room = rooms.get(String(body.roomId || "").toUpperCase());
      if (!room) {
        json(res, 404, { error: "Room not found" });
        return;
      }
      if (room.started) {
        json(res, 409, { error: "Match already started" });
        return;
      }
      if (room.players.length >= room.maxPlayers) {
        json(res, 409, { error: "Room is full" });
        return;
      }
      const playerId = `player_${randomId(8)}`;
      const slot = nextSlot(room.mode, room.players);
      room.players.push({
        id: playerId,
        name: body.name || `Player ${room.players.length + 1}`,
        slot
      });
      sendEvent(room.id, { type: "room_state", room: publicRoom(room) });
      json(res, 200, { room: publicRoom(room), playerId });
    } catch (error) {
      json(res, 400, { error: "Invalid request body" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/start-room") {
    try {
      const body = await parseBody(req);
      const room = rooms.get(String(body.roomId || "").toUpperCase());
      if (!room) {
        json(res, 404, { error: "Room not found" });
        return;
      }
      if (room.hostId !== body.playerId) {
        json(res, 403, { error: "Only the host can start" });
        return;
      }
      if (room.players.length !== room.maxPlayers) {
        json(res, 409, { error: "Room is not full yet" });
        return;
      }
      room.started = true;
      room.snapshot = null;
      sendEvent(room.id, { type: "room_state", room: publicRoom(room) });
      sendEvent(room.id, { type: "match_started", room: publicRoom(room) });
      json(res, 200, { ok: true });
    } catch (error) {
      json(res, 400, { error: "Invalid request body" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/room-action") {
    try {
      const body = await parseBody(req);
      const room = rooms.get(String(body.roomId || "").toUpperCase());
      if (!room) {
        json(res, 404, { error: "Room not found" });
        return;
      }
      const player = room.players.find((entry) => entry.id === body.playerId);
      if (!player) {
        json(res, 403, { error: "Unknown player" });
        return;
      }
      const actionType = String(body.type || "");
      if (actionType === "sync-state" || actionType === "game-over") {
        room.snapshot = body.payload || null;
      }
      sendEvent(room.id, {
        type: "room_action",
        actionType,
        from: player.slot,
        payload: body.payload || null
      });
      json(res, 200, { ok: true });
    } catch (error) {
      json(res, 400, { error: "Invalid request body" });
    }
    return;
  }

  serveFile(pathname, res);
});

server.listen(PORT, HOST, () => {
  console.log(`8 Ball Pool online server running at http://localhost:${PORT}`);
});
