let onlineRoomModulePromise = null;

function getSelectedOnlineBackend() {
  return String(import.meta.env.VITE_ONLINE_BACKEND || "firebase")
    .trim()
    .toLowerCase();
}

export function loadOnlineRoom() {
  if (!onlineRoomModulePromise) {
    onlineRoomModulePromise =
      getSelectedOnlineBackend() === "cloudflare"
        ? import("./onlineRoomCloudflare.js")
        : import("./onlineRoom.js");
  }

  return onlineRoomModulePromise;
}
