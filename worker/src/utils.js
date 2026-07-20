export const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const encoder = new TextEncoder();

export function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(init.headers || {}),
    },
  });
}

export function errorResponse(message, status = 400, code = "bad_request") {
  return json({ ok: false, error: message, code }, { status });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("O corpo da requisição precisa ser um JSON válido.");
  }
}

export function normalizeRoomCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

export function generateRoomCode(length = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) => ROOM_ALPHABET[value % ROOM_ALPHABET.length]).join("");
}

export function cleanText(value, fallback = "", maxLength = 80) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  return text || fallback;
}

export function cleanParticipant(input = {}, forcedId = null) {
  const id = cleanText(forcedId || input.id, "", 120);
  if (!id) throw new Error("Identificador do participante ausente.");

  return {
    id,
    playerName: cleanText(input.playerName, "Jogador", 32),
    teamName: cleanText(input.teamName, "Meu XI", 40),
    formationId: cleanText(input.formationId, "", 40),
    formationName: cleanText(input.formationName, "", 50),
    isReady: input.isReady !== false,
  };
}

export function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function sanitizeConfig(input = {}, existing = null) {
  const onlineMode = existing?.onlineMode || (input.onlineMode === "duel" ? "duel" : "league");
  const maxPlayers = onlineMode === "duel"
    ? 2
    : clampInteger(input.maxPlayers ?? existing?.maxPlayers, 2, 20, 20);

  const pickTimeRaw = String(input.pickTime ?? existing?.pickTime ?? "30");
  const pickTime = ["15", "30", "60", "none"].includes(pickTimeRaw) ? pickTimeRaw : "30";

  const draftTypeRaw = String(input.draftType ?? existing?.draftType ?? "cards");
  const difficultyRaw = String(input.difficulty ?? existing?.difficulty ?? "normal");
  const duelFormatRaw = String(input.duelFormat ?? existing?.duelFormat ?? "single");

  return {
    onlineMode,
    maxPlayers,
    isPrivate: Boolean(input.isPrivate ?? existing?.isPrivate),
    draftType: ["cards", "teams"].includes(draftTypeRaw) ? draftTypeRaw : "cards",
    difficulty: ["normal", "expert"].includes(difficultyRaw) ? difficultyRaw : "normal",
    pickTime,
    picksPerTurn: clampInteger(input.picksPerTurn ?? existing?.picksPerTurn, 1, 3, 1),
    cardsPerTurn: clampInteger(input.cardsPerTurn ?? existing?.cardsPerTurn, 8, 12, 10),
    duelFormat: ["single", "home-away", "best-of-3", "best-of-5"].includes(duelFormatRaw)
      ? duelFormatRaw
      : "single",
    duelExtraTime: Boolean(input.duelExtraTime ?? existing?.duelExtraTime),
    duelPenalties: Boolean(input.duelPenalties ?? existing?.duelPenalties),
  };
}

export function makeToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return toBase64Url(bytes);
}

export function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function hashPassword(password, salt = null) {
  const cleanPassword = String(password || "");
  if (!cleanPassword) return null;

  const saltBytes = salt ? fromBase64Url(salt) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(cleanPassword),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBytes,
      iterations: 100_000,
    },
    key,
    256,
  );

  return {
    salt: toBase64Url(saltBytes),
    hash: toBase64Url(new Uint8Array(bits)),
  };
}

export async function verifyPassword(password, stored) {
  if (!stored?.salt || !stored?.hash) return !password;
  if (!password) return false;
  const derived = await hashPassword(password, stored.salt);
  return constantTimeEqual(derived.hash, stored.hash);
}

export function constantTimeEqual(a, b) {
  const left = encoder.encode(String(a || ""));
  const right = encoder.encode(String(b || ""));
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

export function normalizeHost(participants, hostId) {
  const list = Array.isArray(participants) ? participants : [];
  const nextHostId = list.some((participant) => participant.id === hostId)
    ? hostId
    : list[0]?.id || null;

  return {
    hostId: nextHostId,
    participants: list.map((participant) => ({
      ...participant,
      isHost: participant.id === nextHostId,
    })),
  };
}

export function publicRoom(room) {
  if (!room) return null;
  return {
    id: room.code,
    code: room.code,
    roomName: room.roomName,
    status: room.status,
    hostId: room.hostId,
    config: { ...room.config },
    participants: (room.participants || []).map((participant) => ({ ...participant })),
    participantIds: (room.participants || []).map((participant) => participant.id),
    connectedCount: (room.participants || []).filter((participant) => participant.connected).length,
    draftOrder: Array.isArray(room.draftOrder) ? room.draftOrder.map((participant) => ({ ...participant })) : [],
    isDrawingOrder: Boolean(room.isDrawingOrder),
    rollingParticipant: room.rollingParticipant || "",
    draftState: room.draftState || null,
    leagueResult: room.leagueResult || null,
    leagueResultStored: Boolean(room.leagueResultStored),
    duelResult: room.duelResult || null,
    revealedRounds: Number(room.revealedRounds || 0),
    liveRound: room.liveRound || null,
    liveSpeed: room.liveSpeed || "normal",
    duelLive: room.duelLive || null,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}

export function roomSummary(room) {
  if (!room) return null;
  return {
    id: room.code,
    code: room.code,
    roomName: room.roomName,
    status: room.status,
    hostId: room.hostId,
    onlineMode: room.config?.onlineMode || "league",
    difficulty: room.config?.difficulty || "normal",
    isPrivate: Boolean(room.config?.isPrivate),
    playerCount: room.participants?.length || 0,
    connectedCount: (room.participants || []).filter((participant) => participant.connected).length,
    maxPlayers: room.config?.onlineMode === "duel" ? 2 : Number(room.config?.maxPlayers || 20),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}

export function readAuthHeaders(request) {
  return {
    participantId: cleanText(request.headers.get("x-participant-id"), "", 120),
    roomToken: cleanText(request.headers.get("x-room-token"), "", 240),
  };
}

export function allowedCorsHeaders(origin = "*") {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-participant-id,x-room-token",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

export function withCors(response, request) {
  const origin = request.headers.get("Origin") || "*";
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(allowedCorsHeaders(origin))) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
