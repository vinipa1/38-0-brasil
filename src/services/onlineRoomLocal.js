const ACTIVE_ROOM_KEY = "activeOnlineRoomCode";
const PLAYER_ID_KEY = "onlinePlayerId";

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
  return window.localStorage.getItem(ACTIVE_ROOM_KEY) || "";
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