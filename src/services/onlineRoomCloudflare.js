import {
  clearActiveRoomCode,
  getOrCreateOnlinePlayerId,
  rememberActiveRoomCode,
} from "./onlineRoomLocal";

const DEFAULT_API_URL = "http://127.0.0.1:8787";
const CREDENTIALS_STORAGE_KEY = "38oCloudflareRoomCredentialsV1";
const SOCKET_RECONNECT_DELAY_MS = 1500;
const SOCKET_PING_INTERVAL_MS = 45_000;

export const backendName = "cloudflare";
export const usesSocketPresence = true;
export const leaveOnPageHide = false;
export const supportsGameFlow = true;
export const supportsOrderAndDraft = true;
export const supportsSimulation = false;
export const supportsLeagueSimulation = true;
export const supportsDuelSimulation = false;
export const serverControlsLiveSimulation = true;

function normalizeRoomCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

function getApiBaseUrl() {
  return String(import.meta.env.VITE_ONLINE_API_URL || DEFAULT_API_URL)
    .trim()
    .replace(/\/+$/, "");
}

function buildApiUrl(path) {
  const normalizedPath = String(path || "").startsWith("/") ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
}

function buildWebSocketUrl(path) {
  const url = new URL(buildApiUrl(path));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function readCredentialMap() {
  if (typeof window === "undefined") return {};

  try {
    const parsed = JSON.parse(window.localStorage.getItem(CREDENTIALS_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeCredentialMap(map) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CREDENTIALS_STORAGE_KEY, JSON.stringify(map));
}

function getRoomCredentials(code) {
  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode) return null;
  return readCredentialMap()[normalizedCode] || null;
}

function saveRoomCredentials(code, participantId, roomToken) {
  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode || !participantId || !roomToken) return;

  const map = readCredentialMap();
  map[normalizedCode] = {
    code: normalizedCode,
    participantId: String(participantId),
    roomToken: String(roomToken),
    updatedAt: Date.now(),
  };
  writeCredentialMap(map);
}

function removeRoomCredentials(code) {
  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode) return;

  const map = readCredentialMap();
  delete map[normalizedCode];
  writeCredentialMap(map);
}

function getAuthHeaders(code) {
  const credentials = getRoomCredentials(code);
  if (!credentials?.participantId || !credentials?.roomToken) {
    throw new Error("As credenciais desta sala não foram encontradas neste navegador.");
  }

  return {
    "content-type": "application/json",
    "x-participant-id": credentials.participantId,
    "x-room-token": credentials.roomToken,
  };
}

async function readResponse(response) {
  let data;

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const error = new Error(data?.error || `Erro ${response.status} ao acessar o servidor online.`);
    error.code = data?.code || `http_${response.status}`;
    error.status = response.status;
    throw error;
  }

  return data || {};
}

async function apiRequest(path, options = {}) {
  const response = await fetch(buildApiUrl(path), {
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });

  return readResponse(response);
}

function normalizeRoom(room, serverNowOverride = null) {
  if (!room) return null;

  const receivedAt = Date.now();
  const roomServerNow = Number(room.serverNow);
  const overrideServerNow = Number(serverNowOverride);
  const serverNow = Number.isFinite(roomServerNow)
    ? roomServerNow
    : Number.isFinite(overrideServerNow)
      ? overrideServerNow
      : NaN;
  const serverClockOffset = Number.isFinite(serverNow)
    ? serverNow - receivedAt
    : Number(room._serverClockOffset || 0);

  return {
    ...room,
    serverNow: Number.isFinite(serverNow) ? serverNow : null,
    _serverClockOffset: serverClockOffset,
    _receivedAt: receivedAt,
    id: room.id || room.code,
    code: normalizeRoomCode(room.code || room.id),
    status: room.status || "lobby",
    config: {
      ...(room.config || {}),
      maxPlayers:
        room.config?.onlineMode === "duel"
          ? 2
          : Number(room.config?.maxPlayers || 20),
    },
    participants: Array.isArray(room.participants) ? room.participants : [],
    participantIds:
      room.participantIds ||
      (Array.isArray(room.participants)
        ? room.participants.map((participant) => participant.id)
        : []),
    draftOrder: room.draftOrder || [],
    draftState: room.draftState || null,
    isDrawingOrder: Boolean(room.isDrawingOrder),
    rollingParticipant: room.rollingParticipant || "",
    leagueResult: room.leagueResult || null,
    leagueResultStored: Boolean(room.leagueResultStored),
    duelResult: room.duelResult || null,
    revealedRounds: Number(room.revealedRounds || 0),
    liveRound: room.liveRound || null,
    duelLive: room.duelLive || null,
    liveSpeed: room.liveSpeed || "normal",
  };
}

function normalizeLobbyRoom(room) {
  const playerCount = Number(room?.playerCount || room?.participants?.length || 0);
  const code = normalizeRoomCode(room?.code || room?.id);

  return {
    id: code,
    code,
    roomName: room?.roomName || "Sala 38–0",
    status: room?.status || "lobby",
    hostId: room?.hostId || null,
    config: {
      onlineMode: room?.onlineMode || room?.config?.onlineMode || "league",
      difficulty: room?.difficulty || room?.config?.difficulty || "normal",
      isPrivate: Boolean(room?.isPrivate ?? room?.config?.isPrivate),
      maxPlayers: Number(room?.maxPlayers || room?.config?.maxPlayers || 20),
    },
    playerCount,
    connectedCount: Number(room?.connectedCount || 0),
    // Compatibilidade temporária com a tela atual, que usa participants.length.
    participants: Array.from({ length: playerCount }, (_, index) => ({
      id: `lobby-summary-${code}-${index}`,
    })),
    participantIds: [],
    createdAt: room?.createdAt || null,
    updatedAt: room?.updatedAt || null,
  };
}

function roomMatchesFilters(room, filters = {}) {
  const normalized = normalizeLobbyRoom(room);

  if (filters.onlineMode && normalized.config.onlineMode !== filters.onlineMode) {
    return false;
  }

  if (
    filters.difficulty &&
    normalized.config.onlineMode === "league" &&
    normalized.config.difficulty !== filters.difficulty
  ) {
    return false;
  }

  return normalized.playerCount < normalized.config.maxPlayers;
}

function normalizeLobbyRooms(rooms, filters = {}) {
  return (Array.isArray(rooms) ? rooms : [])
    .filter((room) => roomMatchesFilters(room, filters))
    .map(normalizeLobbyRoom)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

export async function ensureAnonymousAuth() {
  return getOrCreateOnlinePlayerId();
}

export async function fetchRoomByCode(code) {
  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode) return null;

  try {
    const data = await apiRequest(`/api/rooms/${normalizedCode}`);
    return normalizeRoom(data.room);
  } catch (error) {
    if (error?.status === 404 || error?.code === "room_not_found") return null;
    throw error;
  }
}

export async function listLobbyRooms(filters = {}) {
  const params = new URLSearchParams();
  if (filters.onlineMode) params.set("onlineMode", filters.onlineMode);
  if (filters.difficulty) params.set("difficulty", filters.difficulty);

  const suffix = params.size ? `?${params.toString()}` : "";
  const data = await apiRequest(`/api/lobby${suffix}`);
  return normalizeLobbyRooms(data.rooms, filters);
}

export async function createRoomDocument(room) {
  const participantId = await ensureAnonymousAuth();
  const hostParticipant = {
    ...((room.participants || [])[0] || {}),
    id: participantId,
    isHost: true,
  };

  const config = { ...(room.config || {}) };
  const password = String(config.password || config.roomPassword || "").trim();
  delete config.password;
  delete config.roomPassword;

  const data = await apiRequest("/api/rooms", {
    method: "POST",
    body: JSON.stringify({
      code: normalizeRoomCode(room.code),
      roomName: room.roomName || "Sala 38–0",
      config,
      password,
      participant: hostParticipant,
    }),
  });

  const normalizedRoom = normalizeRoom(data.room);
  saveRoomCredentials(normalizedRoom.code, data.participantId, data.roomToken);
  rememberActiveRoomCode(normalizedRoom.code);
  return normalizedRoom;
}

export async function joinRoomDocument(code, participant, options = {}) {
  const normalizedCode = normalizeRoomCode(code);
  const participantId = await ensureAnonymousAuth();
  const previousCredentials = getRoomCredentials(normalizedCode);

  const data = await apiRequest(`/api/rooms/${normalizedCode}/join`, {
    method: "POST",
    body: JSON.stringify({
      participant: {
        ...participant,
        id: participantId,
        isHost: false,
      },
      password: String(options.password || ""),
      reconnectToken:
        previousCredentials?.participantId === participantId
          ? previousCredentials.roomToken
          : "",
    }),
  });

  saveRoomCredentials(normalizedCode, data.participantId, data.roomToken);
  rememberActiveRoomCode(normalizedCode);
  return normalizeRoom(data.room);
}

export async function leaveRoomDocument(code, participantId) {
  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode) return "missing";

  const credentials = getRoomCredentials(normalizedCode);
  if (!credentials) {
    removeRoomCredentials(normalizedCode);
    clearActiveRoomCode();
    return "missing";
  }

  if (participantId && credentials.participantId !== String(participantId)) {
    throw new Error("A identidade local não corresponde ao participante desta sala.");
  }

  try {
    const data = await apiRequest(`/api/rooms/${normalizedCode}/leave`, {
      method: "POST",
      headers: getAuthHeaders(normalizedCode),
      body: "{}",
    });
    return data.result || "left";
  } finally {
    removeRoomCredentials(normalizedCode);
    clearActiveRoomCode();
  }
}

export async function deleteRoomDocument(code) {
  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode) return;

  try {
    await apiRequest(`/api/rooms/${normalizedCode}`, {
      method: "DELETE",
      headers: getAuthHeaders(normalizedCode),
    });
  } finally {
    removeRoomCredentials(normalizedCode);
    clearActiveRoomCode();
  }
}

export async function patchRoomDocument(code, updates) {
  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode) return;

  const keys = Object.keys(updates || {});
  if (!keys.length) return fetchRoomByCode(normalizedCode);

  const lobbyKeys = new Set(["config", "roomName"]);
  const gameKeys = new Set([
    "status",
    "draftOrder",
    "isDrawingOrder",
    "rollingParticipant",
    "draftState",
  ]);
  const unsupportedKeys = keys.filter((key) => !lobbyKeys.has(key) && !gameKeys.has(key));

  if (unsupportedKeys.length) {
    const error = new Error(
      "O lobby, o sorteio e o draft já estão na Cloudflare. A simulação da liga e do duelo será conectada na próxima etapa.",
    );
    error.code = "cloudflare_simulation_not_enabled";
    throw error;
  }

  const hasLobbyUpdates = keys.some((key) => lobbyKeys.has(key));
  const hasGameUpdates = keys.some((key) => gameKeys.has(key));
  let latestRoom = null;

  if (hasLobbyUpdates) {
    const config = { ...(updates.config || {}) };
    const passwordWasProvided =
      Object.prototype.hasOwnProperty.call(config, "password") ||
      Object.prototype.hasOwnProperty.call(config, "roomPassword");
    const password = String(config.password || config.roomPassword || "").trim();
    delete config.password;
    delete config.roomPassword;

    const body = { config };
    if (updates.roomName !== undefined) body.roomName = updates.roomName;
    if (passwordWasProvided) body.password = password;

    const data = await apiRequest(`/api/rooms/${normalizedCode}/config`, {
      method: "PATCH",
      headers: getAuthHeaders(normalizedCode),
      body: JSON.stringify(body),
    });
    latestRoom = normalizeRoom(data.room);
  }

  if (hasGameUpdates) {
    const gameUpdates = Object.fromEntries(
      Object.entries(updates).filter(([key]) => gameKeys.has(key)),
    );
    const data = await apiRequest(`/api/rooms/${normalizedCode}/game`, {
      method: "PATCH",
      headers: getAuthHeaders(normalizedCode),
      body: JSON.stringify({ updates: gameUpdates }),
    });
    latestRoom = normalizeRoom(data.room);
  }

  return latestRoom;
}

async function sendGameCommand(code, command, payload = {}) {
  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode) throw new Error("Código da sala inválido.");

  const data = await apiRequest(`/api/rooms/${normalizedCode}/game`, {
    method: "PATCH",
    headers: getAuthHeaders(normalizedCode),
    body: JSON.stringify({ command, payload }),
  });

  return normalizeRoom(data.room);
}

export async function startOnlineLeagueSimulation(code, payload = {}) {
  return sendGameCommand(code, "start_league", payload);
}

export async function startOnlineLeagueRound(code) {
  return sendGameCommand(code, "start_league_round");
}

export async function simulateAllOnlineLeagueRounds(code) {
  return sendGameCommand(code, "simulate_all_league");
}

export async function updateOnlineSimulationSpeed(code, speed) {
  return sendGameCommand(code, "set_live_speed", { speed });
}

export async function resetOnlineRoomToLobby(code) {
  return sendGameCommand(code, "reset_to_lobby");
}

export function subscribeToRoom(code, onRoomChange, onError) {
  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode) return () => {};

  let stopped = false;
  let socket = null;
  let reconnectTimer = null;
  let pingTimer = null;

  const clearTimers = () => {
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    if (pingTimer) window.clearInterval(pingTimer);
    reconnectTimer = null;
    pingTimer = null;
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect().catch((error) => {
        if (onError) onError(error);
        scheduleReconnect();
      });
    }, SOCKET_RECONNECT_DELAY_MS);
  };

  const connect = async () => {
    if (stopped) return;

    const credentials = getRoomCredentials(normalizedCode);
    if (!credentials) {
      throw new Error("Não foi possível reconectar: credenciais da sala ausentes.");
    }

    const ticketData = await apiRequest(`/api/rooms/${normalizedCode}/socket-ticket`, {
      method: "POST",
      headers: getAuthHeaders(normalizedCode),
      body: "{}",
    });

    if (stopped) return;

    socket = new WebSocket(
      buildWebSocketUrl(
        `/api/rooms/${normalizedCode}/ws?ticket=${encodeURIComponent(ticketData.ticket)}`,
      ),
    );

    socket.addEventListener("open", () => {
      if (stopped || socket?.readyState !== WebSocket.OPEN) return;
      if (pingTimer) window.clearInterval(pingTimer);
      pingTimer = window.setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
      }, SOCKET_PING_INTERVAL_MS);
    });

    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === "connected" || message.type === "room_state") {
        onRoomChange(normalizeRoom(message.room, message.timestamp));
      } else if (message.type === "room_closed") {
        removeRoomCredentials(normalizedCode);
        clearActiveRoomCode();
        onRoomChange(null);
      } else if (message.type === "error" && onError) {
        onError(new Error(message.message || "Erro na conexão da sala."));
      }
    });

    socket.addEventListener("close", (event) => {
      if (pingTimer) window.clearInterval(pingTimer);
      pingTimer = null;
      socket = null;

      if (stopped) return;

      if (event.code === 4004) {
        removeRoomCredentials(normalizedCode);
        clearActiveRoomCode();
        onRoomChange(null);
        return;
      }

      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (onError) onError(new Error("A conexão em tempo real da sala falhou."));
    });
  };

  connect().catch((error) => {
    if (onError) onError(error);
    scheduleReconnect();
  });

  return () => {
    stopped = true;
    clearTimers();
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, "Tela da sala encerrada.");
    }
    socket = null;
  };
}

export function subscribeToLobby(filters, onRoomsChange, onError) {
  let stopped = false;
  let socket = null;
  let reconnectTimer = null;

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, SOCKET_RECONNECT_DELAY_MS);
  };

  const connect = () => {
    if (stopped) return;

    socket = new WebSocket(buildWebSocketUrl("/api/lobby/ws"));

    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === "lobby_state") {
        onRoomsChange(normalizeLobbyRooms(message.rooms, filters));
      }
    });

    socket.addEventListener("close", () => {
      socket = null;
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (onError) onError(new Error("Não foi possível acompanhar as salas em tempo real."));
    });
  };

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, "Tela de matchmaking encerrada.");
    }
    socket = null;
  };
}

// A presença e a limpeza são controladas pelo WebSocket e pelos alarms do Durable Object.
export async function touchParticipantPresence() {}
export async function pruneStaleParticipants() {}
export async function cleanupOldRooms() {}

export async function saveOnlineLeagueResult() {
  throw new Error("A persistência da liga será conectada à Cloudflare em uma próxima etapa.");
}

export async function clearOnlineLeagueResult() {}

export async function applyRoomTransaction() {
  throw new Error("Transações do draft ainda não estão disponíveis no backend Cloudflare.");
}
