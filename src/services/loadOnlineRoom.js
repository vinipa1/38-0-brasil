let onlineRoomModulePromise = null;

export function loadOnlineRoom() {
  if (!onlineRoomModulePromise) {
    onlineRoomModulePromise = import("./onlineRoom.js");
  }

  return onlineRoomModulePromise;
}