import { LobbyDirectoryDurableObject } from "./lobby.js";
import { RoomDurableObject } from "./room.js";
import {
  allowedCorsHeaders,
  errorResponse,
  generateRoomCode,
  json,
  normalizeRoomCode,
  withCors,
} from "./utils.js";

export { LobbyDirectoryDurableObject, RoomDurableObject };

function getRoomStub(env, code) {
  const id = env.ROOMS.idFromName(code);
  return env.ROOMS.get(id);
}

function getLobbyStub(env) {
  const id = env.LOBBY.idFromName("global");
  return env.LOBBY.get(id);
}

async function createRoom(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse("O corpo da requisição precisa ser um JSON válido.", 400, "invalid_json");
  }

  const requestedCode = normalizeRoomCode(body.code);
  const attempts = requestedCode ? 1 : 12;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = requestedCode || generateRoomCode();
    const stub = getRoomStub(env, code);
    const internalRequest = new Request(`https://room.internal/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, code }),
    });
    const response = await stub.fetch(internalRequest);

    if (response.status !== 409 || requestedCode) return response;
  }

  return errorResponse("Não foi possível gerar um código livre. Tente novamente.", 503, "room_code_generation_failed");
}

function testerHtml() {
  return String.raw`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>38-0 Brasil — Teste de lobby</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #07100c; color: #f4fff8; }
    main { width: min(1120px, calc(100% - 28px)); margin: 28px auto 64px; }
    h1, h2, h3, p { margin-top: 0; }
    p { color: #b8cabf; line-height: 1.55; }
    .hero { margin-bottom: 18px; }
    .badge { display: inline-flex; padding: 7px 11px; border-radius: 999px; background: #143924; color: #72ed9f; font-size: 12px; font-weight: 900; }
    .layout { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card { background: #102019; border: 1px solid #284235; border-radius: 18px; padding: 20px; box-shadow: 0 18px 45px rgba(0,0,0,.22); }
    .wide { grid-column: 1 / -1; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .grid.three { grid-template-columns: 1fr 1fr 1fr; }
    label { display: block; margin-bottom: 5px; color: #a9bdb1; font-size: 12px; font-weight: 800; }
    input, select, button { width: 100%; min-height: 44px; border-radius: 10px; border: 1px solid #385748; padding: 0 12px; font: inherit; }
    input, select { background: #0b1711; color: white; }
    button { background: #32d176; color: #06210f; font-weight: 900; cursor: pointer; }
    button.secondary { background: #20392c; color: white; }
    button.danger { background: #792d34; border-color: #a3414b; color: white; }
    button:disabled { opacity: .48; cursor: not-allowed; }
    .row { display: flex; gap: 10px; align-items: center; }
    .row > * { flex: 1; }
    .status { padding: 12px; border-radius: 10px; background: #09150f; color: #d9eee1; min-height: 44px; }
    .room-code { font-family: ui-monospace, monospace; font-size: 26px; letter-spacing: .1em; color: #72ed9f; }
    .participants, .rooms { display: grid; gap: 9px; }
    .participant, .room { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center; border-radius: 12px; padding: 12px; background: #0a1710; border: 1px solid #243a2e; }
    .muted { color: #8ea497; font-size: 12px; }
    .online { color: #72ed9f; }
    .offline { color: #f1b36b; }
    .log { height: 190px; overflow: auto; background: #050b08; border-radius: 12px; padding: 12px; font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; }
    .hidden { display: none !important; }
    .check { display: flex; align-items: center; gap: 9px; min-height: 44px; }
    .check input { width: 18px; min-height: 18px; }
    @media (max-width: 760px) { .layout, .grid, .grid.three { grid-template-columns: 1fr; } .wide { grid-column: auto; } .row { flex-direction: column; } }
  </style>
</head>
<body>
<main>
  <section class="hero">
    <span class="badge">ETAPA 3C · BRASILEIRÃO AO VIVO</span>
    <h1 style="margin-top:12px">Servidor online do 38-0 Brasil</h1>
    <p>O lobby continua disponível para diagnóstico. O Brasileirão agora é calculado no servidor e revelado ao vivo, de forma sincronizada para todos.</p>
  </section>

  <div class="layout">
    <section class="card">
      <h2>Criar sala</h2>
      <div class="grid">
        <div><label>Nome da sala</label><input id="create-room-name" value="Sala de teste" maxlength="60" /></div>
        <div><label>Seu nome</label><input id="create-player-name" value="Host" maxlength="32" /></div>
        <div><label>Nome do seu time</label><input id="create-team-name" value="Time do Host" maxlength="40" /></div>
        <div><label>Modo</label><select id="create-mode"><option value="league">Brasileirão</option><option value="duel">Duelo 1v1</option></select></div>
        <div><label>Máximo de participantes</label><input id="create-max" type="number" min="2" max="20" value="20" /></div>
        <div><label class="check"><input id="create-private" type="checkbox" /> Sala privada</label><input id="create-password" class="hidden" type="password" placeholder="Senha da sala" /></div>
      </div>
      <button id="create-button" style="margin-top:12px">Criar sala</button>
    </section>

    <section class="card">
      <h2>Entrar por código</h2>
      <div class="grid">
        <div><label>Código</label><input id="join-code" maxlength="8" placeholder="ABC123" /></div>
        <div><label>Seu nome</label><input id="join-player-name" value="Convidado" maxlength="32" /></div>
        <div><label>Nome do seu time</label><input id="join-team-name" value="Time Convidado" maxlength="40" /></div>
        <div><label>Senha, caso exista</label><input id="join-password" type="password" placeholder="Senha" /></div>
      </div>
      <button id="join-button" style="margin-top:12px">Entrar na sala</button>
    </section>

    <section class="card wide">
      <div class="row">
        <div>
          <h2 style="margin-bottom:5px">Salas abertas</h2>
          <p style="margin-bottom:0">Esta lista recebe atualizações em tempo real pelo Durable Object do lobby.</p>
        </div>
        <button id="refresh-lobby" class="secondary" style="max-width:180px">Atualizar lista</button>
      </div>
      <div id="rooms" class="rooms" style="margin-top:14px"></div>
    </section>

    <section id="active-room-card" class="card wide hidden">
      <div class="row">
        <div>
          <div class="muted">SALA ATUAL</div>
          <div id="active-room-code" class="room-code">------</div>
          <h2 id="active-room-name" style="margin:6px 0"></h2>
          <div id="active-room-status" class="status"></div>
        </div>
        <div class="row" style="max-width:440px">
          <button id="reconnect-button" class="secondary">Reconectar</button>
          <button id="disconnect-button" class="secondary">Desconectar</button>
          <button id="leave-button" class="danger">Sair da sala</button>
        </div>
      </div>

      <h3 style="margin-top:20px">Participantes</h3>
      <div id="participants" class="participants"></div>

      <div class="grid" style="margin-top:18px">
        <div><label>Atualizar seu nome</label><input id="profile-player-name" maxlength="32" /></div>
        <div><label>Atualizar seu time</label><input id="profile-team-name" maxlength="40" /></div>
      </div>
      <div class="row" style="margin-top:10px">
        <button id="update-profile-button" class="secondary">Salvar perfil</button>
        <button id="close-room-button" class="danger">Encerrar sala (somente host)</button>
      </div>

      <div class="row" style="margin-top:18px">
        <input id="test-message" placeholder="Mensagem de diagnóstico" />
        <button id="send-test-message" style="max-width:180px">Enviar</button>
      </div>
      <div id="log" class="log" style="margin-top:10px"></div>
    </section>
  </div>
</main>
<script>
  var roomSocket = null;
  var lobbySocket = null;
  var pingTimer = null;
  var activeRoom = null;
  var credentials = loadCredentials();

  function byId(id) { return document.getElementById(id); }
  function value(id) { return byId(id).value.trim(); }
  function randomId() { return crypto.randomUUID ? crypto.randomUUID() : 'player-' + Date.now() + '-' + Math.random().toString(36).slice(2); }
  function normalizeCode(code) { return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }

  function log(message) {
    var text = typeof message === 'string' ? message : JSON.stringify(message, null, 2);
    byId('log').textContent += '[' + new Date().toLocaleTimeString() + '] ' + text + '\n';
    byId('log').scrollTop = byId('log').scrollHeight;
  }

  function saveCredentials(next) {
    credentials = next;
    if (next) sessionStorage.setItem('38o-room-credentials', JSON.stringify(next));
    else sessionStorage.removeItem('38o-room-credentials');
  }

  function loadCredentials() {
    try { return JSON.parse(sessionStorage.getItem('38o-room-credentials') || 'null'); }
    catch { return null; }
  }

  function authHeaders() {
    return {
      'content-type': 'application/json',
      'x-participant-id': credentials.participantId,
      'x-room-token': credentials.roomToken
    };
  }

  async function api(path, options) {
    var response = await fetch(path, options || {});
    var data;
    try { data = await response.json(); }
    catch { data = { error: 'Resposta inválida do servidor.' }; }
    if (!response.ok) throw new Error(data.error || 'Erro ' + response.status);
    return data;
  }

  function wsUrl(path) {
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + path;
  }

  async function connectRoomSocket() {
    if (!credentials) return;
    if (roomSocket && (roomSocket.readyState === WebSocket.OPEN || roomSocket.readyState === WebSocket.CONNECTING)) return;

    byId('active-room-status').textContent = 'Solicitando conexão segura...';
    var ticketData = await api('/api/rooms/' + credentials.code + '/socket-ticket', {
      method: 'POST',
      headers: authHeaders(),
      body: '{}'
    });

    roomSocket = new WebSocket(wsUrl('/api/rooms/' + credentials.code + '/ws?ticket=' + encodeURIComponent(ticketData.ticket)));
    roomSocket.addEventListener('open', function () {
      byId('active-room-status').textContent = 'Conectado em tempo real.';
      log('WebSocket da sala conectado.');
      clearInterval(pingTimer);
      pingTimer = setInterval(function () {
        if (roomSocket && roomSocket.readyState === WebSocket.OPEN) roomSocket.send('ping');
      }, 45000);
    });
    roomSocket.addEventListener('message', function (event) {
      if (event.data === 'pong') return;
      var message;
      try { message = JSON.parse(event.data); }
      catch { message = event.data; }
      if (message.type === 'connected' || message.type === 'room_state') renderRoom(message.room);
      if (message.type === 'room_closed') {
        log('A sala foi encerrada pelo host.');
        clearActiveRoom();
      }
      if (message.type === 'test_message') log(message.from.playerName + ': ' + message.text);
    });
    roomSocket.addEventListener('close', function (event) {
      clearInterval(pingTimer);
      byId('active-room-status').textContent = 'Desconectado do tempo real. Código ' + event.code + '.';
      log('WebSocket encerrado: ' + event.code + ' ' + event.reason);
      roomSocket = null;
    });
    roomSocket.addEventListener('error', function () { log('Erro no WebSocket da sala.'); });
  }

  function disconnectRoomSocket() {
    if (roomSocket) roomSocket.close(1000, 'Desconexão manual de teste.');
  }

  function connectLobbySocket() {
    if (lobbySocket && lobbySocket.readyState <= WebSocket.OPEN) return;
    lobbySocket = new WebSocket(wsUrl('/api/lobby/ws'));
    lobbySocket.addEventListener('message', function (event) {
      if (event.data === 'pong') return;
      try {
        var message = JSON.parse(event.data);
        if (message.type === 'lobby_state') renderLobby(message.rooms || []);
      } catch {}
    });
    lobbySocket.addEventListener('close', function () {
      lobbySocket = null;
      setTimeout(connectLobbySocket, 2500);
    });
  }

  async function refreshLobby() {
    var data = await api('/api/lobby');
    renderLobby(data.rooms || []);
  }

  function renderLobby(rooms) {
    var box = byId('rooms');
    if (!rooms.length) {
      box.innerHTML = '<div class="status">Nenhuma sala aberta neste momento.</div>';
      return;
    }
    box.innerHTML = rooms.map(function (room) {
      var privacy = room.isPrivate ? 'Privada' : 'Pública';
      var mode = room.onlineMode === 'duel' ? 'Duelo 1v1' : 'Brasileirão';
      return '<div class="room"><div><strong>' + escapeHtml(room.roomName) + '</strong><div class="muted">' + room.code + ' · ' + mode + ' · ' + privacy + ' · ' + room.playerCount + '/' + room.maxPlayers + '</div></div><button class="secondary join-listed" data-code="' + room.code + '" style="width:120px">Usar código</button></div>';
    }).join('');
    document.querySelectorAll('.join-listed').forEach(function (button) {
      button.addEventListener('click', function () {
        byId('join-code').value = button.dataset.code;
        byId('join-code').focus();
      });
    });
  }

  function renderRoom(room) {
    if (!room) return;
    activeRoom = room;
    byId('active-room-card').classList.remove('hidden');
    byId('active-room-code').textContent = room.code;
    byId('active-room-name').textContent = room.roomName;
    byId('active-room-status').textContent = room.connectedCount + ' conectado(s) · ' + room.participants.length + '/' + room.config.maxPlayers + ' participante(s)';
    var me = room.participants.find(function (participant) { return credentials && participant.id === credentials.participantId; });
    if (me) {
      byId('profile-player-name').value = me.playerName;
      byId('profile-team-name').value = me.teamName;
    }
    byId('participants').innerHTML = room.participants.map(function (participant) {
      var state = participant.connected ? '<span class="online">online</span>' : '<span class="offline">reconectando</span>';
      var host = participant.isHost ? ' · HOST' : '';
      return '<div class="participant"><div><strong>' + escapeHtml(participant.playerName) + host + '</strong><div class="muted">' + escapeHtml(participant.teamName) + '</div></div><div>' + state + '</div></div>';
    }).join('');
    byId('close-room-button').disabled = !me || !me.isHost;
  }

  function clearActiveRoom() {
    disconnectRoomSocket();
    saveCredentials(null);
    activeRoom = null;
    byId('active-room-card').classList.add('hidden');
  }

  function escapeHtml(text) {
    return String(text || '').replace(/[&<>'"]/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char];
    });
  }

  byId('create-private').addEventListener('change', function () {
    byId('create-password').classList.toggle('hidden', !byId('create-private').checked);
  });
  byId('create-mode').addEventListener('change', function () {
    if (byId('create-mode').value === 'duel') byId('create-max').value = '2';
  });

  byId('create-button').addEventListener('click', async function () {
    try {
      var participantId = randomId();
      var data = await api('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roomName: value('create-room-name'),
          password: value('create-password'),
          participant: {
            id: participantId,
            playerName: value('create-player-name'),
            teamName: value('create-team-name'),
            formationId: '4-3-3',
            formationName: '4-3-3'
          },
          config: {
            onlineMode: value('create-mode'),
            maxPlayers: Number(value('create-max')),
            isPrivate: byId('create-private').checked,
            draftType: 'cards', difficulty: 'normal', pickTime: '30', picksPerTurn: 1, cardsPerTurn: 10
          }
        })
      });
      saveCredentials({ code: data.room.code, participantId: data.participantId, roomToken: data.roomToken });
      renderRoom(data.room);
      byId('join-code').value = data.room.code;
      log('Sala criada.');
      await connectRoomSocket();
    } catch (error) { alert(error.message); }
  });

  byId('join-button').addEventListener('click', async function () {
    try {
      var code = normalizeCode(value('join-code'));
      if (!code) throw new Error('Digite o código da sala.');
      var participantId = randomId();
      var data = await api('/api/rooms/' + code + '/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          password: value('join-password'),
          participant: {
            id: participantId,
            playerName: value('join-player-name'),
            teamName: value('join-team-name'),
            formationId: '4-3-3',
            formationName: '4-3-3'
          }
        })
      });
      saveCredentials({ code: code, participantId: data.participantId, roomToken: data.roomToken });
      renderRoom(data.room);
      log('Entrada autorizada pelo servidor.');
      await connectRoomSocket();
    } catch (error) { alert(error.message); }
  });

  byId('refresh-lobby').addEventListener('click', function () { refreshLobby().catch(function (error) { alert(error.message); }); });
  byId('disconnect-button').addEventListener('click', disconnectRoomSocket);
  byId('reconnect-button').addEventListener('click', function () { connectRoomSocket().catch(function (error) { alert(error.message); }); });

  byId('leave-button').addEventListener('click', async function () {
    if (!credentials) return;
    try {
      await api('/api/rooms/' + credentials.code + '/leave', { method: 'POST', headers: authHeaders(), body: '{}' });
      clearActiveRoom();
    } catch (error) { alert(error.message); }
  });

  byId('update-profile-button').addEventListener('click', async function () {
    if (!credentials) return;
    try {
      var data = await api('/api/rooms/' + credentials.code + '/participant', {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ participant: { playerName: value('profile-player-name'), teamName: value('profile-team-name'), formationId: '4-3-3', formationName: '4-3-3' } })
      });
      renderRoom(data.room);
    } catch (error) { alert(error.message); }
  });

  byId('close-room-button').addEventListener('click', async function () {
    if (!credentials || !confirm('Encerrar a sala para todos?')) return;
    try {
      await api('/api/rooms/' + credentials.code, { method: 'DELETE', headers: authHeaders() });
      clearActiveRoom();
    } catch (error) { alert(error.message); }
  });

  byId('send-test-message').addEventListener('click', function () {
    var text = value('test-message');
    if (!text || !roomSocket || roomSocket.readyState !== WebSocket.OPEN) return;
    roomSocket.send(JSON.stringify({ type: 'test_message', text: text }));
    byId('test-message').value = '';
  });

  connectLobbySocket();
  refreshLobby().catch(function () {});
  if (credentials) {
    api('/api/rooms/' + credentials.code).then(function (data) {
      renderRoom(data.room);
      return connectRoomSocket();
    }).catch(function () { saveCredentials(null); });
  }
</script>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: allowedCorsHeaders(request.headers.get("Origin") || "*") });
    }

    if (url.pathname === "/") {
      return new Response(testerHtml(), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    if (url.pathname === "/api/health") {
      return withCors(json({ ok: true, service: "38-0-brasil-online", stage: "3C", timestamp: Date.now() }), request);
    }

    if (url.pathname === "/api/lobby" && request.method === "GET") {
      const lobby = getLobbyStub(env);
      const rooms = await lobby.listRooms({
        onlineMode: url.searchParams.get("onlineMode") || null,
        difficulty: url.searchParams.get("difficulty") || null,
      });
      return withCors(json({ ok: true, rooms }), request);
    }

    if (url.pathname === "/api/lobby/ws") {
      return getLobbyStub(env).fetch(request);
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      return withCors(await createRoom(request, env), request);
    }

    const match = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{1,8})(?:\/(join|leave|participant|config|game|socket-ticket|ws))?$/);
    if (!match) return withCors(errorResponse("Rota não encontrada.", 404, "not_found"), request);

    const code = normalizeRoomCode(match[1]);
    const action = match[2] || "state";
    const stub = getRoomStub(env, code);

    if (action === "ws") return stub.fetch(request);

    let internalAction = action;
    if (request.method === "DELETE" && action === "state") internalAction = "close";
    const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();
    const internalRequest = new Request(`https://room.internal/${internalAction}`, {
      method: request.method,
      headers: request.headers,
      body,
    });
    return withCors(await stub.fetch(internalRequest), request);
  },
};
