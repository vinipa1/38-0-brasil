import { DurableObject } from "cloudflare:workers";
import {
  cleanParticipant,
  cleanText,
  errorResponse,
  hashPassword,
  json,
  makeToken,
  normalizeHost,
  publicRoom,
  readAuthHeaders,
  readJson,
  roomSummary,
  sanitizeConfig,
  verifyPassword,
} from "./utils.js";
import {
  addRoundToPlayerStats,
  addRoundToLeaderboards,
  buildPublicCompletedRound,
  buildPublicLiveRound,
  clearLeagueStorage,
  createLeagueSimulation,
  getHiddenLeagueRound,
  getLeagueMeta,
  getLiveMinute,
  getNextLeagueAlarmAt,
  getSpeedInterval,
  replacePublicRound,
  storeLeagueSimulation,
} from "./league.js";

const ROOM_KEY = "room";
const TOKEN_PREFIX = "participant-token:";
const TICKET_PREFIX = "socket-ticket:";
const DISCONNECT_GRACE_MS = 2 * 60 * 1000;
const SOCKET_TICKET_TTL_MS = 30 * 1000;
const MAX_DRAFT_STATE_BYTES = 2_000_000;
const MAX_DRAFT_CARDS = 40;
const MAX_DRAFT_LOG_ITEMS = 20;
const MAX_LINEUP_ITEMS = 20;
const GAME_STATUSES = new Set(["lobby", "order", "draft"]);
const GAME_UPDATE_KEYS = new Set([
  "status",
  "draftOrder",
  "isDrawingOrder",
  "rollingParticipant",
  "draftState",
]);

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function jsonEquals(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getDraftParticipantId(order, turnIndex) {
  if (!Array.isArray(order) || !order.length) return null;
  const cleanIndex = Math.max(0, Number.parseInt(turnIndex, 10) || 0);
  const roundIndex = Math.floor(cleanIndex / order.length);
  const positionInRound = cleanIndex % order.length;
  const participant = roundIndex % 2 === 0
    ? order[positionInRound]
    : order[order.length - 1 - positionInRound];
  return participant?.id || null;
}

function getTotalDraftPicks(draftState) {
  return Object.values(draftState?.lineupsMap || {}).reduce(
    (total, lineup) => total + (Array.isArray(lineup) ? lineup.length : 0),
    0,
  );
}

function canonicalizeDraftOrder(input, participants) {
  if (!Array.isArray(input)) throw new Error("A ordem do draft precisa ser uma lista.");

  const participantById = new Map((participants || []).map((participant) => [participant.id, participant]));
  const seen = new Set();
  const order = [];

  for (const entry of input) {
    const id = cleanText(entry?.id, "", 120);
    if (!id || seen.has(id) || !participantById.has(id)) {
      throw new Error("A ordem do draft contém um participante inválido ou repetido.");
    }
    seen.add(id);
    order.push({ ...participantById.get(id) });
  }

  if (order.length > participantById.size) {
    throw new Error("A ordem do draft possui participantes demais.");
  }

  return order;
}

function sanitizeDraftState(input, room) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Estado do draft inválido.");
  }

  const serialized = JSON.stringify(input);
  if (serialized.length > MAX_DRAFT_STATE_BYTES) {
    throw new Error("O estado do draft ficou grande demais para ser sincronizado.");
  }

  const orderIds = (room.draftOrder || []).map((participant) => participant.id);
  if (!orderIds.length) throw new Error("A ordem do draft ainda não foi definida.");

  const lineupsMap = {};
  for (const participantId of orderIds) {
    const lineup = input.lineupsMap?.[participantId];
    if (!Array.isArray(lineup)) {
      throw new Error("O estado do draft não contém todos os elencos.");
    }
    if (lineup.length > MAX_LINEUP_ITEMS) {
      throw new Error("Um dos elencos possui jogadores demais.");
    }
    lineupsMap[participantId] = cloneJson(lineup);
  }

  const pickedPlayerKeys = Array.isArray(input.pickedPlayerKeys)
    ? input.pickedPlayerKeys.map((key) => cleanText(key, "", 180)).filter(Boolean)
    : [];
  if (pickedPlayerKeys.length > orderIds.length * MAX_LINEUP_ITEMS) {
    throw new Error("A lista de jogadores escolhidos ficou grande demais.");
  }
  if (new Set(pickedPlayerKeys).size !== pickedPlayerKeys.length) {
    throw new Error("O draft tentou escolher o mesmo jogador mais de uma vez.");
  }

  const currentCards = Array.isArray(input.currentCards) ? cloneJson(input.currentCards) : [];
  if (currentCards.length > MAX_DRAFT_CARDS) {
    throw new Error("Há cards demais no turno atual.");
  }

  const currentTurnIndex = Number.parseInt(input.currentTurnIndex, 10);
  const picksMadeThisTurn = Number.parseInt(input.picksMadeThisTurn, 10);
  if (!Number.isInteger(currentTurnIndex) || currentTurnIndex < 0 || currentTurnIndex > 10_000) {
    throw new Error("Índice do turno do draft inválido.");
  }
  if (!Number.isInteger(picksMadeThisTurn) || picksMadeThisTurn < 0 || picksMadeThisTurn > 3) {
    throw new Error("Contador de escolhas do turno inválido.");
  }

  return {
    currentTurnIndex,
    picksMadeThisTurn,
    lineupsMap,
    pickedPlayerKeys,
    currentCards,
    currentTeamOption: input.currentTeamOption ? cloneJson(input.currentTeamOption) : null,
    log: Array.isArray(input.log) ? cloneJson(input.log.slice(0, MAX_DRAFT_LOG_ITEMS)) : [],
    isComplete: Boolean(input.isComplete),
  };
}

function findCardIdentity(card) {
  return cleanText(card?.identityKey || card?.player?.playerKey || card?.player?.id || card?.player?.name, "", 180);
}

function playerMatchesCard(lineupItem, card) {
  const pickedPlayer = lineupItem?.player || {};
  const cardPlayer = card?.player || {};
  const pickedId = cleanText(pickedPlayer.id, "", 180);
  const cardId = cleanText(cardPlayer.id, "", 180);
  if (pickedId && cardId) return pickedId === cardId;
  return cleanText(pickedPlayer.name, "", 180) === cleanText(cardPlayer.name, "", 180);
}

function validateDraftProgress(room, previousState, nextState, actor, isHost) {
  if (!previousState) throw new Error("O draft ainda não foi iniciado.");
  if (previousState.isComplete) throw new Error("O draft já foi finalizado.");

  const previousTotal = getTotalDraftPicks(previousState);
  const nextTotal = getTotalDraftPicks(nextState);
  const currentParticipantId = getDraftParticipantId(room.draftOrder, previousState.currentTurnIndex);

  if (nextTotal === previousTotal + 1) {
    if (!currentParticipantId || actor.id !== currentParticipantId) {
      throw new Error("Não é a sua vez de escolher.");
    }
    if (nextState.currentTurnIndex < previousState.currentTurnIndex) {
      throw new Error("O draft tentou voltar para um turno anterior.");
    }

    for (const participant of room.draftOrder || []) {
      const previousLineup = previousState.lineupsMap?.[participant.id] || [];
      const nextLineup = nextState.lineupsMap?.[participant.id] || [];

      if (participant.id === currentParticipantId) {
        if (nextLineup.length !== previousLineup.length + 1) {
          throw new Error("A escolha não adicionou exatamente um jogador ao elenco correto.");
        }
        if (!jsonEquals(previousLineup, nextLineup.slice(0, -1))) {
          throw new Error("A escolha tentou alterar jogadores que já estavam no elenco.");
        }
      } else if (!jsonEquals(previousLineup, nextLineup)) {
        throw new Error("A escolha tentou alterar o elenco de outro participante.");
      }
    }

    if (nextState.pickedPlayerKeys.length !== previousState.pickedPlayerKeys.length + 1) {
      throw new Error("A escolha não atualizou corretamente a lista de jogadores escolhidos.");
    }
    if (!jsonEquals(previousState.pickedPlayerKeys, nextState.pickedPlayerKeys.slice(0, -1))) {
      throw new Error("A escolha tentou reescrever o histórico do draft.");
    }

    const addedKey = nextState.pickedPlayerKeys[nextState.pickedPlayerKeys.length - 1];
    const offeredCard = (previousState.currentCards || []).find((card) => findCardIdentity(card) === addedKey);
    const addedLineupItem = nextState.lineupsMap[currentParticipantId].at(-1);
    if (!offeredCard || !playerMatchesCard(addedLineupItem, offeredCard)) {
      throw new Error("O jogador escolhido não estava entre as opções válidas do turno.");
    }
    return;
  }

  if (nextTotal === previousTotal) {
    const currentStillExists = (room.participants || []).some(
      (participant) => participant.id === currentParticipantId,
    );
    if (!isHost || currentStillExists || nextState.currentTurnIndex <= previousState.currentTurnIndex) {
      throw new Error("Não foi possível avançar este turno sem realizar uma escolha.");
    }
    if (!jsonEquals(previousState.lineupsMap, nextState.lineupsMap)) {
      throw new Error("O avanço automático tentou alterar os elencos.");
    }
    if (!jsonEquals(previousState.pickedPlayerKeys, nextState.pickedPlayerKeys)) {
      throw new Error("O avanço automático tentou alterar os jogadores escolhidos.");
    }
    return;
  }

  throw new Error("O estado recebido contém uma quantidade inválida de novas escolhas.");
}

export class RoomDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;

    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );

    this.ctx.blockConcurrencyWhile(async () => {
      await this.reconcileStoredConnections();
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path.endsWith("/ws")) return this.openWebSocket(request, url);
      if (path.endsWith("/create") && request.method === "POST") return this.createRoom(request);
      if (path.endsWith("/state") && request.method === "GET") return this.getState();
      if (path.endsWith("/join") && request.method === "POST") return this.joinRoom(request);
      if (path.endsWith("/socket-ticket") && request.method === "POST") return this.issueSocketTicket(request);
      if (path.endsWith("/leave") && request.method === "POST") return this.leaveRoom(request);
      if (path.endsWith("/participant") && request.method === "PATCH") return this.updateParticipant(request);
      if (path.endsWith("/config") && request.method === "PATCH") return this.updateConfig(request);
      if (path.endsWith("/game") && request.method === "PATCH") return this.updateGameState(request);
      if (path.endsWith("/close") && request.method === "DELETE") return this.closeRoom(request);
      return errorResponse("Rota da sala não encontrada.", 404, "not_found");
    } catch (error) {
      console.error("RoomDurableObject error", error);
      return errorResponse(error?.message || "Erro interno da sala.", 500, "internal_error");
    }
  }

  async createRoom(request) {
    const existing = await this.getRoom();
    if (existing) return errorResponse("Código de sala já está em uso.", 409, "room_code_in_use");

    const body = await readJson(request);
    const code = cleanText(body.code, "", 8).toUpperCase();
    if (!code) return errorResponse("Código da sala ausente.", 400, "missing_room_code");

    const host = cleanParticipant(body.participant);
    const config = sanitizeConfig(body.config || {});
    const password = String(body.password || "").trim();

    if (config.isPrivate && !password) {
      return errorResponse("Digite uma senha para criar uma sala privada.", 400, "password_required");
    }

    config.isPrivate = Boolean(config.isPrivate && password);
    const passwordData = config.isPrivate ? await hashPassword(password) : null;
    const now = Date.now();
    const token = makeToken();

    const room = {
      version: 2,
      code,
      roomName: cleanText(body.roomName, "Sala 38–0", 60),
      status: "lobby",
      hostId: host.id,
      config,
      passwordData,
      participants: [{
        ...host,
        isHost: true,
        connected: false,
        joinedAt: now,
        lastConnectedAt: null,
        disconnectedAt: now,
      }],
      draftOrder: [],
      isDrawingOrder: false,
      rollingParticipant: "",
      draftState: null,
      leagueResult: null,
      leagueResultStored: false,
      duelResult: null,
      revealedRounds: 0,
      liveRound: null,
      liveSpeed: "normal",
      duelLive: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.ctx.storage.put(ROOM_KEY, room);
    await this.ctx.storage.put(`${TOKEN_PREFIX}${host.id}`, token);
    await this.scheduleNextAlarm(room);
    await this.syncLobby(room);

    return json({
      ok: true,
      room: publicRoom(room),
      participantId: host.id,
      roomToken: token,
    }, { status: 201 });
  }

  async getState() {
    const room = await this.getRoom();
    if (!room) return errorResponse("Sala não encontrada.", 404, "room_not_found");
    return json({ ok: true, room: publicRoom(room) });
  }

  async joinRoom(request) {
    const room = await this.getRoom();
    if (!room) return errorResponse("Sala não encontrada.", 404, "room_not_found");
    if (room.status !== "lobby") {
      return errorResponse("Essa sala já está em andamento.", 409, "room_already_started");
    }

    const body = await readJson(request);
    const participant = cleanParticipant(body.participant);
    const reconnectToken = cleanText(body.reconnectToken, "", 240);

    if (room.config?.isPrivate) {
      const validPassword = await verifyPassword(String(body.password || ""), room.passwordData);
      if (!validPassword) return errorResponse("Senha incorreta.", 403, "wrong_password");
    }

    const existingIndex = room.participants.findIndex((entry) => entry.id === participant.id);
    const now = Date.now();

    if (existingIndex >= 0) {
      const storedToken = await this.ctx.storage.get(`${TOKEN_PREFIX}${participant.id}`);
      if (!reconnectToken || reconnectToken !== storedToken) {
        return errorResponse("Essa identidade já está sendo usada na sala.", 409, "participant_already_exists");
      }

      room.participants[existingIndex] = {
        ...room.participants[existingIndex],
        ...participant,
        isHost: room.participants[existingIndex].id === room.hostId,
        connected: false,
        disconnectedAt: now,
      };
      room.updatedAt = now;
      await this.saveAndBroadcast(room);
      await this.scheduleNextAlarm(room);

      return json({
        ok: true,
        room: publicRoom(room),
        participantId: participant.id,
        roomToken: storedToken,
        reconnected: true,
      });
    }

    const maxPlayers = room.config?.onlineMode === "duel" ? 2 : Number(room.config?.maxPlayers || 20);
    if (room.participants.length >= maxPlayers) {
      return errorResponse("A sala já está cheia.", 409, "room_full");
    }

    const token = makeToken();
    room.participants.push({
      ...participant,
      isHost: false,
      connected: false,
      joinedAt: now,
      lastConnectedAt: null,
      disconnectedAt: now,
    });
    room.updatedAt = now;

    await this.ctx.storage.put(`${TOKEN_PREFIX}${participant.id}`, token);
    await this.saveAndBroadcast(room);
    await this.scheduleNextAlarm(room);

    return json({
      ok: true,
      room: publicRoom(room),
      participantId: participant.id,
      roomToken: token,
      reconnected: false,
    });
  }

  async issueSocketTicket(request) {
    const room = await this.getRoom();
    if (!room) return errorResponse("Sala não encontrada.", 404, "room_not_found");

    const auth = await this.validateAuth(request, room);
    if (!auth.ok) return auth.response;

    const ticket = makeToken(24);
    await this.ctx.storage.put(`${TICKET_PREFIX}${ticket}`, {
      participantId: auth.participant.id,
      expiresAt: Date.now() + SOCKET_TICKET_TTL_MS,
    });

    return json({ ok: true, ticket, expiresInMs: SOCKET_TICKET_TTL_MS });
  }

  async openWebSocket(request, url) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return errorResponse("Este endpoint exige WebSocket.", 426, "websocket_required");
    }

    const ticket = cleanText(url.searchParams.get("ticket"), "", 240);
    if (!ticket) return errorResponse("Ticket de conexão ausente.", 401, "missing_socket_ticket");

    const ticketKey = `${TICKET_PREFIX}${ticket}`;
    const ticketData = await this.ctx.storage.get(ticketKey);
    await this.ctx.storage.delete(ticketKey);

    if (!ticketData || Number(ticketData.expiresAt || 0) < Date.now()) {
      return errorResponse("Ticket de conexão inválido ou expirado.", 401, "invalid_socket_ticket");
    }

    const room = await this.getRoom();
    if (!room) return errorResponse("Sala não encontrada.", 404, "room_not_found");

    const participant = room.participants.find((entry) => entry.id === ticketData.participantId);
    if (!participant) return errorResponse("Participante não pertence à sala.", 403, "participant_not_in_room");

    for (const existingSocket of this.ctx.getWebSockets()) {
      const attachment = existingSocket.deserializeAttachment();
      if (attachment?.participantId === participant.id) {
        try {
          existingSocket.close(4001, "Sessão substituída por uma nova conexão.");
        } catch {
          // Conexão anterior já estava sendo encerrada.
        }
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ participantId: participant.id });

    const now = Date.now();
    participant.connected = true;
    participant.disconnectedAt = null;
    participant.lastConnectedAt = now;
    room.updatedAt = now;
    await this.ctx.storage.put(ROOM_KEY, room);
    await this.scheduleNextAlarm(room);
    await this.syncLobby(room);

    server.send(JSON.stringify({
      type: "connected",
      participantId: participant.id,
      room: publicRoom(room),
      timestamp: now,
    }));
    this.broadcastRoomState(room);

    return new Response(null, { status: 101, webSocket: client });
  }

  async leaveRoom(request) {
    const room = await this.getRoom();
    if (!room) return json({ ok: true, result: "missing" });

    const auth = await this.validateAuth(request, room);
    if (!auth.ok) return auth.response;

    const result = await this.removeParticipant(room, auth.participant.id, "left");
    return json({ ok: true, result, room: result === "deleted" ? null : publicRoom(await this.getRoom()) });
  }

  async updateParticipant(request) {
    const room = await this.getRoom();
    if (!room) return errorResponse("Sala não encontrada.", 404, "room_not_found");
    if (room.status !== "lobby") return errorResponse("O perfil só pode ser alterado no lobby.", 409, "room_not_in_lobby");

    const auth = await this.validateAuth(request, room);
    if (!auth.ok) return auth.response;

    const body = await readJson(request);
    const clean = cleanParticipant(body.participant || {}, auth.participant.id);
    const index = room.participants.findIndex((entry) => entry.id === auth.participant.id);
    room.participants[index] = {
      ...room.participants[index],
      ...clean,
      isHost: auth.participant.id === room.hostId,
    };
    room.updatedAt = Date.now();
    await this.saveAndBroadcast(room);

    return json({ ok: true, room: publicRoom(room) });
  }

  async updateConfig(request) {
    const room = await this.getRoom();
    if (!room) return errorResponse("Sala não encontrada.", 404, "room_not_found");
    if (room.status !== "lobby") return errorResponse("A configuração só pode ser alterada no lobby.", 409, "room_not_in_lobby");

    const auth = await this.validateAuth(request, room, { hostOnly: true });
    if (!auth.ok) return auth.response;

    const body = await readJson(request);
    const nextConfig = sanitizeConfig(body.config || {}, room.config);
    const wantsPrivate = Boolean(body.config?.isPrivate ?? room.config?.isPrivate);
    const passwordProvided = Object.prototype.hasOwnProperty.call(body, "password");
    const password = String(body.password || "").trim();

    nextConfig.isPrivate = wantsPrivate;
    if (wantsPrivate && passwordProvided) {
      if (!password) return errorResponse("Digite uma senha para manter a sala privada.", 400, "password_required");
      room.passwordData = await hashPassword(password);
    } else if (wantsPrivate && !room.passwordData) {
      return errorResponse("Digite uma senha para tornar a sala privada.", 400, "password_required");
    } else if (!wantsPrivate) {
      room.passwordData = null;
    }

    room.config = nextConfig;
    if (body.roomName !== undefined) room.roomName = cleanText(body.roomName, room.roomName, 60);
    room.updatedAt = Date.now();
    await this.saveAndBroadcast(room);

    return json({ ok: true, room: publicRoom(room) });
  }

  async updateGameState(request) {
    const room = await this.getRoom();
    if (!room) return errorResponse("Sala não encontrada.", 404, "room_not_found");

    const auth = await this.validateAuth(request, room);
    if (!auth.ok) return auth.response;

    const body = await readJson(request);

    if (body?.command) {
      return this.handleGameCommand(room, auth, body.command, body.payload || {});
    }

    const updates = body?.updates && typeof body.updates === "object" ? body.updates : body;
    const keys = Object.keys(updates || {});
    const unsupportedKeys = keys.filter((key) => !GAME_UPDATE_KEYS.has(key));
    if (!keys.length) return errorResponse("Nenhuma atualização foi enviada.", 400, "empty_game_update");
    if (unsupportedKeys.length) {
      return errorResponse(
        `Campos ainda não disponíveis nesta etapa: ${unsupportedKeys.join(", ")}.`,
        400,
        "unsupported_game_fields",
      );
    }

    const isHost = room.hostId === auth.participant.id;
    const hostOnlyKeys = ["status", "draftOrder", "isDrawingOrder", "rollingParticipant"];
    if (hostOnlyKeys.some((key) => Object.prototype.hasOwnProperty.call(updates, key)) && !isHost) {
      return errorResponse("Somente o host pode controlar o sorteio e as telas do jogo.", 403, "host_only");
    }

    const previousStatus = room.status || "lobby";
    const nextStatus = updates.status === undefined ? previousStatus : cleanText(updates.status, previousStatus, 20);
    if (!GAME_STATUSES.has(nextStatus)) {
      return errorResponse("Esta etapa libera apenas lobby, sorteio e draft.", 409, "simulation_not_enabled");
    }

    if (nextStatus !== previousStatus) {
      const allowedTransitions = {
        lobby: new Set(["order"]),
        order: new Set(["lobby", "draft"]),
        draft: new Set(["order", "lobby"]),
      };
      if (!allowedTransitions[previousStatus]?.has(nextStatus)) {
        return errorResponse("Transição de tela inválida para o estado atual da sala.", 409, "invalid_status_transition");
      }
      if (!isHost) return errorResponse("Somente o host pode mudar a etapa da sala.", 403, "host_only");
      if (nextStatus === "order" && previousStatus === "lobby" && room.participants.length < 2) {
        return errorResponse("São necessários pelo menos dois participantes para iniciar.", 409, "not_enough_participants");
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "draftOrder")) {
      if (previousStatus !== "order" && nextStatus !== "order") {
        return errorResponse("A ordem só pode ser alterada na tela de sorteio.", 409, "room_not_in_order");
      }
      room.draftOrder = canonicalizeDraftOrder(updates.draftOrder, room.participants);
    }

    if (Object.prototype.hasOwnProperty.call(updates, "isDrawingOrder")) {
      if (previousStatus !== "order" && nextStatus !== "order") {
        return errorResponse("O sorteio só pode ser controlado na tela de ordem.", 409, "room_not_in_order");
      }
      room.isDrawingOrder = Boolean(updates.isDrawingOrder);
    }

    if (Object.prototype.hasOwnProperty.call(updates, "rollingParticipant")) {
      if (previousStatus !== "order" && nextStatus !== "order") {
        return errorResponse("O sorteio só pode ser controlado na tela de ordem.", 409, "room_not_in_order");
      }
      room.rollingParticipant = cleanText(updates.rollingParticipant, "", 80);
    }

    const startingDraft = previousStatus !== "draft" && nextStatus === "draft";
    if (startingDraft) {
      if (room.draftOrder.length !== room.participants.length || !room.draftOrder.length) {
        return errorResponse("Finalize o sorteio da ordem antes de iniciar o draft.", 409, "draft_order_incomplete");
      }
      if (!Object.prototype.hasOwnProperty.call(updates, "draftState")) {
        return errorResponse("O estado inicial do draft não foi enviado.", 400, "missing_draft_state");
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "draftState")) {
      if (nextStatus !== "draft") {
        return errorResponse("O estado do draft só pode ser alterado durante o draft.", 409, "room_not_in_draft");
      }

      const nextDraftState = sanitizeDraftState(updates.draftState, room);
      if (startingDraft || !room.draftState) {
        if (!isHost) return errorResponse("Somente o host pode iniciar o draft.", 403, "host_only");
        if (getTotalDraftPicks(nextDraftState) !== 0 || nextDraftState.currentTurnIndex !== 0) {
          return errorResponse("O draft precisa começar sem jogadores escolhidos.", 400, "invalid_initial_draft_state");
        }
      } else {
        try {
          validateDraftProgress(room, room.draftState, nextDraftState, auth.participant, isHost);
        } catch (error) {
          return errorResponse(error.message, 409, "invalid_draft_update");
        }
      }
      room.draftState = nextDraftState;
    }

    if (Object.prototype.hasOwnProperty.call(updates, "status")) {
      room.status = nextStatus;
      if (nextStatus === "lobby") {
        room.isDrawingOrder = false;
        room.rollingParticipant = "";
      }
    }

    room.updatedAt = Date.now();
    await this.saveAndBroadcast(room, { syncLobby: previousStatus !== room.status });
    return json({ ok: true, room: publicRoom(room) });
  }

  async handleGameCommand(room, auth, command, payload) {
    if (room.hostId !== auth.participant.id) {
      return errorResponse("Somente o host pode controlar a simulação.", 403, "host_only");
    }

    if (command === "start_league") {
      if (room.config?.onlineMode !== "league") {
        return errorResponse("Esta sala não está configurada para o Brasileirão.", 409, "wrong_online_mode");
      }
      if (room.status !== "draft" || !room.draftState?.isComplete) {
        return errorResponse("Finalize o draft antes de iniciar o Brasileirão.", 409, "draft_not_complete");
      }

      try {
        const simulation = createLeagueSimulation(room, payload.databaseTeams);
        await storeLeagueSimulation(this.ctx.storage, simulation);
        room.status = "league";
        room.leagueResult = simulation.publicResult;
        room.leagueResultStored = true;
        room.draftState = null;
        room.revealedRounds = 0;
        room.liveRound = null;
        room.liveSpeed = ["turbo", "fast", "normal", "slow"].includes(payload.liveSpeed)
          ? payload.liveSpeed
          : "normal";
        room.duelResult = null;
        room.duelLive = null;
        room.updatedAt = Date.now();
        await this.saveAndBroadcast(room, { syncLobby: true });
        await this.scheduleNextAlarm(room);
        return json({ ok: true, room: publicRoom(room) });
      } catch (error) {
        return errorResponse(error?.message || "Não foi possível montar o Brasileirão.", 400, "league_start_failed");
      }
    }

    if (command === "start_league_round") {
      if (room.status !== "league" || !room.leagueResult) {
        return errorResponse("O Brasileirão ainda não foi iniciado.", 409, "league_not_started");
      }
      if (room.liveRound?.roundStartedAt) {
        return errorResponse("Já existe uma rodada em andamento.", 409, "round_already_live");
      }

      const meta = await getLeagueMeta(this.ctx.storage);
      const roundNumber = Number(room.revealedRounds || 0) + 1;
      if (!meta || roundNumber > Number(meta.roundCount || 0)) {
        return errorResponse("O campeonato já terminou.", 409, "league_finished");
      }

      const hiddenRound = await getHiddenLeagueRound(this.ctx.storage, roundNumber);
      if (!hiddenRound) {
        return errorResponse("Os dados secretos desta rodada não foram encontrados.", 500, "league_round_missing");
      }

      const now = Date.now();
      room.liveRound = {
        roundNumber,
        minute: 0,
        roundStartedAt: now,
        serverControlled: true,
      };
      room.leagueResult = replacePublicRound(
        room.leagueResult,
        roundNumber,
        buildPublicLiveRound(hiddenRound, 0),
      );
      room.updatedAt = now;
      await this.saveAndBroadcast(room, { syncLobby: false });
      await this.scheduleNextAlarm(room);
      return json({ ok: true, room: publicRoom(room) });
    }

    if (command === "simulate_all_league") {
      if (room.status !== "league" || !room.leagueResult) {
        return errorResponse("O Brasileirão ainda não foi iniciado.", 409, "league_not_started");
      }

      const meta = await getLeagueMeta(this.ctx.storage);
      if (!meta) return errorResponse("Os dados do campeonato não foram encontrados.", 500, "league_meta_missing");

      let publicResult = room.leagueResult;
      for (let roundNumber = 1; roundNumber <= Number(meta.roundCount || 0); roundNumber += 1) {
        const hiddenRound = await getHiddenLeagueRound(this.ctx.storage, roundNumber);
        if (hiddenRound) {
          publicResult = addRoundToLeaderboards(publicResult, hiddenRound);
          publicResult = addRoundToPlayerStats(publicResult, hiddenRound);
          publicResult = replacePublicRound(publicResult, roundNumber, buildPublicCompletedRound(hiddenRound));
        }
      }

      room.leagueResult = publicResult;
      room.revealedRounds = Number(meta.roundCount || 0);
      room.liveRound = null;
      room.updatedAt = Date.now();
      await this.saveAndBroadcast(room, { syncLobby: false });
      await this.scheduleNextAlarm(room);
      return json({ ok: true, room: publicRoom(room) });
    }

    if (command === "set_live_speed") {
      const nextSpeed = ["turbo", "fast", "normal", "slow"].includes(payload.speed)
        ? payload.speed
        : null;
      if (!nextSpeed) return errorResponse("Velocidade inválida.", 400, "invalid_live_speed");

      const now = Date.now();
      if (room.status === "league" && room.liveRound?.roundStartedAt) {
        const currentMinute = getLiveMinute(
          room.liveRound.roundStartedAt,
          room.liveSpeed || "normal",
          90,
          now,
        );
        room.liveRound.roundStartedAt = now - currentMinute * getSpeedInterval(nextSpeed);
        room.liveRound.minute = currentMinute;
        const hiddenRound = await getHiddenLeagueRound(this.ctx.storage, room.liveRound.roundNumber);
        if (hiddenRound) {
          room.leagueResult = replacePublicRound(
            room.leagueResult,
            room.liveRound.roundNumber,
            buildPublicLiveRound(hiddenRound, currentMinute),
          );
        }
      }

      room.liveSpeed = nextSpeed;
      room.updatedAt = now;
      await this.saveAndBroadcast(room, { syncLobby: false });
      await this.scheduleNextAlarm(room);
      return json({ ok: true, room: publicRoom(room) });
    }

    if (command === "reset_to_lobby") {
      await clearLeagueStorage(this.ctx.storage);
      room.status = "lobby";
      room.draftOrder = [];
      room.draftState = null;
      room.isDrawingOrder = false;
      room.rollingParticipant = "";
      room.leagueResult = null;
      room.leagueResultStored = false;
      room.duelResult = null;
      room.revealedRounds = 0;
      room.liveRound = null;
      room.duelLive = null;
      room.liveSpeed = "normal";
      room.updatedAt = Date.now();
      await this.saveAndBroadcast(room, { syncLobby: true });
      await this.scheduleNextAlarm(room);
      return json({ ok: true, room: publicRoom(room) });
    }

    return errorResponse("Comando de jogo desconhecido.", 400, "unknown_game_command");
  }

  async applyLeagueProgress(room, now = Date.now()) {
    if (room.status !== "league" || !room.liveRound?.roundStartedAt || !room.leagueResult) {
      return { changed: false, finished: false };
    }

    const roundNumber = Number(room.liveRound.roundNumber || 0);
    const hiddenRound = await getHiddenLeagueRound(this.ctx.storage, roundNumber);
    if (!hiddenRound) return { changed: false, finished: false };

    const minute = getLiveMinute(
      room.liveRound.roundStartedAt,
      room.liveSpeed || "normal",
      90,
      now,
    );
    const currentPublicRound = room.leagueResult.rounds?.find((round) => round.round === roundNumber);
    const previousEventCount = (currentPublicRound?.matches || []).reduce(
      (total, match) => total + (match.events?.length || 0),
      0,
    );

    if (minute >= 90) {
      room.leagueResult = addRoundToLeaderboards(room.leagueResult, hiddenRound);
      room.leagueResult = addRoundToPlayerStats(room.leagueResult, hiddenRound);
      room.leagueResult = replacePublicRound(
        room.leagueResult,
        roundNumber,
        buildPublicCompletedRound(hiddenRound),
      );
      room.revealedRounds = Math.max(Number(room.revealedRounds || 0), roundNumber);
      room.liveRound = null;
      room.updatedAt = now;
      return { changed: true, finished: true };
    }

    const nextPublicRound = buildPublicLiveRound(hiddenRound, minute);
    const nextEventCount = nextPublicRound.matches.reduce(
      (total, match) => total + (match.events?.length || 0),
      0,
    );
    room.liveRound.minute = minute;

    if (nextEventCount !== previousEventCount) {
      room.leagueResult = replacePublicRound(room.leagueResult, roundNumber, nextPublicRound);
      room.updatedAt = now;
      return { changed: true, finished: false };
    }

    return { changed: false, finished: false };
  }

  async closeRoom(request) {
    const room = await this.getRoom();
    if (!room) return json({ ok: true, result: "missing" });

    const auth = await this.validateAuth(request, room, { hostOnly: true });
    if (!auth.ok) return auth.response;

    await this.broadcast({ type: "room_closed", code: room.code, timestamp: Date.now() });
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.close(4004, "Sala encerrada pelo host."); } catch {}
    }
    await this.removeRoomCompletely(room.code);
    return json({ ok: true, result: "deleted" });
  }

  async webSocketMessage(ws, rawMessage) {
    if (String(rawMessage) === "ping") return;

    const attachment = ws.deserializeAttachment();
    if (!attachment?.participantId) return;

    let message;
    try {
      message = JSON.parse(String(rawMessage));
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Mensagem inválida." }));
      return;
    }

    if (message.type === "test_message") {
      const room = await this.getRoom();
      const sender = room?.participants?.find((entry) => entry.id === attachment.participantId);
      const text = cleanText(message.text, "", 300);
      if (!sender || !text) return;

      await this.broadcast({
        type: "test_message",
        from: { participantId: sender.id, playerName: sender.playerName },
        text,
        timestamp: Date.now(),
      });
    }
  }

  async webSocketClose(ws) {
    await this.markSocketDisconnected(ws);
  }

  async webSocketError(ws) {
    await this.markSocketDisconnected(ws);
  }

  async alarm() {
    const room = await this.getRoom();
    if (!room) return;

    const now = Date.now();
    const activeIds = this.getActiveParticipantIds();
    const expiredIds = room.participants
      .filter((participant) => !activeIds.has(participant.id))
      .filter((participant) => participant.disconnectedAt && now - participant.disconnectedAt >= DISCONNECT_GRACE_MS)
      .map((participant) => participant.id);

    let changed = false;
    let syncLobby = false;

    if (expiredIds.length) {
      room.participants = room.participants.filter((participant) => !expiredIds.includes(participant.id));
      for (const participantId of expiredIds) {
        await this.ctx.storage.delete(`${TOKEN_PREFIX}${participantId}`);
      }

      if (!room.participants.length) {
        await this.removeRoomCompletely(room.code);
        return;
      }

      const normalized = normalizeHost(room.participants, room.hostId);
      room.participants = normalized.participants;
      room.hostId = normalized.hostId;
      room.updatedAt = now;
      changed = true;
      syncLobby = true;
    }

    const leagueProgress = await this.applyLeagueProgress(room, now);
    if (leagueProgress.changed) changed = true;

    if (changed) {
      await this.saveAndBroadcast(room, { syncLobby });
    }
    await this.scheduleNextAlarm(room);
  }

  async getRoom() {
    return (await this.ctx.storage.get(ROOM_KEY)) || null;
  }

  async validateAuth(request, room, options = {}) {
    const { participantId, roomToken } = readAuthHeaders(request);
    if (!participantId || !roomToken) {
      return { ok: false, response: errorResponse("Credenciais da sala ausentes.", 401, "missing_room_credentials") };
    }

    const participant = room.participants.find((entry) => entry.id === participantId);
    const storedToken = await this.ctx.storage.get(`${TOKEN_PREFIX}${participantId}`);
    if (!participant || !storedToken || storedToken !== roomToken) {
      return { ok: false, response: errorResponse("Credenciais da sala inválidas.", 403, "invalid_room_credentials") };
    }

    if (options.hostOnly && room.hostId !== participantId) {
      return { ok: false, response: errorResponse("Somente o host pode executar esta ação.", 403, "host_only") };
    }

    return { ok: true, participant };
  }

  async removeParticipant(room, participantId, reason) {
    const existed = room.participants.some((entry) => entry.id === participantId);
    if (!existed) return "missing";

    room.participants = room.participants.filter((entry) => entry.id !== participantId);
    if (room.status === "order" && Array.isArray(room.draftOrder)) {
      room.draftOrder = room.draftOrder.filter((entry) => entry.id !== participantId);
      room.isDrawingOrder = false;
      room.rollingParticipant = "";
    }
    await this.ctx.storage.delete(`${TOKEN_PREFIX}${participantId}`);

    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (attachment?.participantId === participantId) {
        try { socket.close(1000, reason === "left" ? "Saída voluntária." : "Participante removido."); } catch {}
      }
    }

    if (!room.participants.length) {
      await this.removeRoomCompletely(room.code);
      return "deleted";
    }

    const normalized = normalizeHost(room.participants, room.hostId);
    room.participants = normalized.participants;
    room.hostId = normalized.hostId;
    room.updatedAt = Date.now();
    await this.saveAndBroadcast(room);
    await this.scheduleNextAlarm(room);
    return "left";
  }

  async markSocketDisconnected(ws) {
    const attachment = ws.deserializeAttachment();
    const participantId = attachment?.participantId;
    if (!participantId) return;

    const stillConnected = this.ctx.getWebSockets().some((socket) => {
      if (socket === ws) return false;
      return socket.deserializeAttachment()?.participantId === participantId;
    });
    if (stillConnected) return;

    const room = await this.getRoom();
    if (!room) return;
    const participant = room.participants.find((entry) => entry.id === participantId);
    if (!participant) return;

    participant.connected = false;
    participant.disconnectedAt = Date.now();
    room.updatedAt = Date.now();
    await this.ctx.storage.put(ROOM_KEY, room);
    this.broadcastRoomState(room);
    await this.syncLobby(room);
    await this.scheduleNextAlarm(room);
  }

  getActiveParticipantIds() {
    const ids = new Set();
    for (const socket of this.ctx.getWebSockets()) {
      const participantId = socket.deserializeAttachment()?.participantId;
      if (participantId) ids.add(participantId);
    }
    return ids;
  }

  async reconcileStoredConnections() {
    const room = await this.getRoom();
    if (!room) return;

    const activeIds = this.getActiveParticipantIds();
    const now = Date.now();
    let changed = false;

    for (const participant of room.participants) {
      const connected = activeIds.has(participant.id);
      if (participant.connected !== connected) {
        participant.connected = connected;
        changed = true;
      }
      if (!connected && !participant.disconnectedAt) {
        participant.disconnectedAt = now;
        changed = true;
      }
      if (connected && participant.disconnectedAt) {
        participant.disconnectedAt = null;
        changed = true;
      }
    }

    if (changed) {
      room.updatedAt = now;
      await this.ctx.storage.put(ROOM_KEY, room);
      await this.syncLobby(room);
    }
    await this.scheduleNextAlarm(room);
  }

  async saveAndBroadcast(room, { syncLobby = true } = {}) {
    await this.ctx.storage.put(ROOM_KEY, room);
    this.broadcastRoomState(room);
    if (syncLobby) await this.syncLobby(room);
  }

  broadcastRoomState(room) {
    this.broadcast({ type: "room_state", room: publicRoom(room), timestamp: Date.now() });
  }

  async broadcast(payload) {
    const serialized = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(serialized);
      } catch {
        // O evento de fechamento será tratado pela plataforma.
      }
    }
  }

  async syncLobby(room) {
    try {
      const lobbyId = this.env.LOBBY.idFromName("global");
      const lobby = this.env.LOBBY.get(lobbyId);
      const hasConnectedParticipant = (room.participants || []).some(
        (participant) => participant.connected,
      );

      // Salas iniciadas somem imediatamente do lobby. Salas em espera sem
      // ninguém conectado também ficam ocultas e são excluídas pelo alarm
      // após os 2 minutos de tolerância para reconexão.
      if (room.status !== "lobby" || !hasConnectedParticipant) {
        await lobby.removeRoom(room.code);
        return;
      }

      await lobby.upsertRoom(roomSummary(room));
    } catch (error) {
      console.error("Falha ao sincronizar diretório de salas", error);
    }
  }

  async removeRoomCompletely(code) {
    try {
      const lobbyId = this.env.LOBBY.idFromName("global");
      const lobby = this.env.LOBBY.get(lobbyId);
      await lobby.removeRoom(code);
    } catch (error) {
      console.error("Falha ao remover sala do diretório", error);
    }
    await this.ctx.storage.deleteAll();
  }

  async scheduleNextAlarm(room) {
    const candidates = (room.participants || [])
      .filter((participant) => !participant.connected && participant.disconnectedAt)
      .map((participant) => Number(participant.disconnectedAt) + DISCONNECT_GRACE_MS)
      .filter(Number.isFinite);

    if (room.status === "league" && room.liveRound?.roundStartedAt) {
      const hiddenRound = await getHiddenLeagueRound(this.ctx.storage, room.liveRound.roundNumber);
      const leagueAlarmAt = getNextLeagueAlarmAt(room, hiddenRound, Date.now());
      if (Number.isFinite(leagueAlarmAt)) candidates.push(leagueAlarmAt);
    }

    if (!candidates.length) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    await this.ctx.storage.setAlarm(Math.min(...candidates));
  }
}

