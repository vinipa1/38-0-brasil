import { DurableObject } from "cloudflare:workers";
import { json } from "./utils.js";

const ROOM_PREFIX = "room:";

function isVisibleLobbyRoom(room) {
  if (!room || room.status !== "lobby") return false;

  const playerCount = Number(room.playerCount || 0);
  const connectedCount = Number(room.connectedCount || 0);
  const maxPlayers = Math.max(1, Number(room.maxPlayers || 20));

  // Uma sala só aparece enquanto está aguardando, tem alguém conectado
  // e ainda possui vaga. Não há limite artificial de quantidade no lobby.
  return playerCount > 0 && connectedCount > 0 && playerCount < maxPlayers;
}

export class LobbyDirectoryDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }

  async upsertRoom(summary) {
    if (!summary?.code) return;

    const key = `${ROOM_PREFIX}${summary.code}`;
    if (!isVisibleLobbyRoom(summary)) {
      await this.ctx.storage.delete(key);
    } else {
      await this.ctx.storage.put(key, summary);
    }

    await this.broadcastState();
  }

  async removeRoom(code) {
    if (!code) return;
    await this.ctx.storage.delete(`${ROOM_PREFIX}${code}`);
    await this.broadcastState();
  }

  async listRooms(filters = {}) {
    const entries = await this.ctx.storage.list({ prefix: ROOM_PREFIX });
    const onlineMode = filters.onlineMode || null;
    const difficulty = filters.difficulty || null;

    return Array.from(entries.values())
      .filter(isVisibleLobbyRoom)
      .filter((room) => !onlineMode || room.onlineMode === onlineMode)
      .filter((room) => !difficulty || room.onlineMode !== "league" || room.difficulty === difficulty)
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ ok: false, error: "Este endpoint aceita apenas WebSocket." }, { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ type: "lobby" });

    server.send(JSON.stringify({
      type: "lobby_state",
      rooms: await this.listRooms(),
      timestamp: Date.now(),
    }));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, rawMessage) {
    if (String(rawMessage) === "refresh") {
      ws.send(JSON.stringify({
        type: "lobby_state",
        rooms: await this.listRooms(),
        timestamp: Date.now(),
      }));
    }
  }

  webSocketClose() {}

  webSocketError() {}

  async broadcastState() {
    const payload = JSON.stringify({
      type: "lobby_state",
      rooms: await this.listRooms(),
      timestamp: Date.now(),
    });

    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        // A plataforma enviará o evento de fechamento quando necessário.
      }
    }
  }
}
