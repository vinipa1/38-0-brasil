const ACTIVE_ROOM_KEY = "activeOnlineRoomCode";
const PLAYER_ID_KEY = "onlinePlayerId";
const CLOUDFLARE_CREDENTIALS_KEY = "38oCloudflareRoomCredentialsV1";

export function getOrCreateOnlinePlayerId() {
  if (typeof window === "undefined") return "server";

  let playerId = window.localStorage.getItem(PLAYER_ID_KEY);

  if (!playerId) {
    playerId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `player-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(PLAYER_ID_KEY, playerId);
  }

  return playerId;
}

export function rememberActiveRoomCode(code) {
  if (typeof window === "undefined" || !code) return;
  window.localStorage.setItem(ACTIVE_ROOM_KEY, code);
}

export function getRememberedRoomCode() {
  if (typeof window === "undefined") return "";

  const activeCode = window.localStorage.getItem(ACTIVE_ROOM_KEY) || "";
  if (activeCode) return activeCode;

  // Recuperação extra: se o código ativo tiver sido removido por uma falha
  // temporária, ainda podemos descobrir a sala pelas credenciais persistidas.
  try {
    const credentials = JSON.parse(
      window.localStorage.getItem(CLOUDFLARE_CREDENTIALS_KEY) || "{}",
    );
    const latest = Object.values(credentials || {})
      .filter((entry) => entry?.code && entry?.participantId && entry?.roomToken)
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))[0];
    return latest?.code || "";
  } catch {
    return "";
  }
}

export function forgetRememberedRoom(code) {
  if (typeof window === "undefined") return;

  const normalizedCode = String(code || "").trim().toUpperCase();
  const activeCode = window.localStorage.getItem(ACTIVE_ROOM_KEY) || "";
  if (!normalizedCode || activeCode === normalizedCode) {
    window.localStorage.removeItem(ACTIVE_ROOM_KEY);
  }

  try {
    const credentials = JSON.parse(
      window.localStorage.getItem(CLOUDFLARE_CREDENTIALS_KEY) || "{}",
    );
    if (normalizedCode && credentials && typeof credentials === "object") {
      delete credentials[normalizedCode];
      window.localStorage.setItem(
        CLOUDFLARE_CREDENTIALS_KEY,
        JSON.stringify(credentials),
      );
    }
  } catch {
    // Se o mapa estiver corrompido, limpamos somente o código ativo.
  }
}

export function clearActiveRoomCode() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACTIVE_ROOM_KEY);
}

export function mapRoomStatusToScreen(status) {
  switch (status) {
    case "lobby":
      return "online-lobby";
    case "order":
      return "online-order";
    case "draft":
      return "online-draft";
    case "league":
      return "online-league";
    case "duel":
      return "online-duel";
    default:
      return "online-lobby";
  }
}