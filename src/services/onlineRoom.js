import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { auth, db, ensureAnonymousAuth } from "../firebase";
import {
  clearActiveRoomCode,
  rememberActiveRoomCode,
} from "./onlineRoomLocal";

const ROOMS_COLLECTION = "rooms";
const LEAGUE_DATA_ID = "result";
export const ONLINE_PRESENCE_STALE_MS = 5 * 60 * 1000; // 5 minutes for room inactivity cleanup

function removeUndefinedDeep(value) {
  if (Array.isArray(value)) {
    return value.map(removeUndefinedDeep).filter((v) => v !== undefined);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([k, v]) => [k, removeUndefinedDeep(v)])
        .filter(([, v]) => v !== undefined)
    );
  }
  return value;
}

function normalizeRoomCode(code) {
  return String(code || "").trim().toUpperCase();
}

function getRoomRef(code) {
  return doc(db, ROOMS_COLLECTION, normalizeRoomCode(code));
}

function getLeagueResultRef(code) {
  return doc(db, ROOMS_COLLECTION, normalizeRoomCode(code), "leagueData", LEAGUE_DATA_ID);
}

export function stampParticipantPresence(participant) {
  return {
    ...participant,
    lastSeen: Date.now(),
  };
}

export function getParticipantIds(participants) {
  return (participants || []).map((participant) => participant.id);
}

function normalizeParticipants(participants, hostId) {
  const nextHostId = hostId || participants[0]?.id || null;

  return participants.map((participant) => ({
    ...participant,
    isHost: participant.id === nextHostId,
  }));
}

async function attachLeagueResult(room) {
  if (!room) return null;

  if (room.leagueResult) {
    return room;
  }

  if (!room.leagueResultStored) {
    return room;
  }

  const leagueSnapshot = await getDoc(getLeagueResultRef(room.code || room.id));
  if (!leagueSnapshot.exists()) {
    return room;
  }

  return {
    ...room,
    leagueResult: leagueSnapshot.data().leagueResult || null,
  };
}

export { ensureAnonymousAuth };

export async function fetchRoomByCode(code) {
  await ensureAnonymousAuth();

  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode) return null;

  const snapshot = await getDoc(getRoomRef(normalizedCode));
  if (!snapshot.exists()) return null;

  return attachLeagueResult({ id: snapshot.id, ...snapshot.data() });
}

export async function cleanupOldRooms(maxAgeMs = 5 * 60 * 1000) {
  await ensureAnonymousAuth();

  const now = Date.now();

  // Fetch recent lobbies to avoid loading too much; old ones will be caught by the time check
  const snapshot = await getDocs(
    query(
      collection(db, ROOMS_COLLECTION),
      where("status", "==", "lobby"),
      limit(100)
    )
  );

  const promises = [];
  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const updated = data.updatedAt?.seconds ? data.updatedAt.seconds * 1000 : (data.createdAt?.seconds ? data.createdAt.seconds * 1000 : 0);
    if (now - updated > maxAgeMs) {
      promises.push(pruneStaleParticipants(doc.id).catch(() => {}));
    }
  });

  await Promise.all(promises);
}

export async function listLobbyRooms({ onlineMode = null, difficulty = null, maxResults = 40 } = {}) {
  await ensureAnonymousAuth();

  const snapshot = await getDocs(
    query(
      collection(db, ROOMS_COLLECTION),
      where("status", "==", "lobby"),
      limit(maxResults)
    )
  );

  return snapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }))
    .filter((room) => {
      if (onlineMode && room.config?.onlineMode !== onlineMode) return false;
      if (difficulty && room.config?.onlineMode === "league" && room.config?.difficulty !== difficulty) {
        return false;
      }

      const maxPlayers = room.config?.onlineMode === "duel" ? 2 : Number(room.config?.maxPlayers || 20);
      return (room.participants?.length || 0) < maxPlayers;
    })
    .sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
}

export async function createRoomDocument(room) {
  // Ensure we are authenticated first
  await ensureAnonymousAuth();

  // Small delay to give the Firebase SDK time to attach the ID token
  // to subsequent Firestore requests (helps on the very first write after anonymous sign-in).
  await new Promise((resolve) => setTimeout(resolve, 120));

  // Prefer the *live* auth.currentUser.uid at the exact moment we build the payload.
  // This is the value that Firestore security rules will see as request.auth.uid.
  const liveUid = auth.currentUser?.uid;

  // (debug logs removed for production)

  if (!liveUid) {
    throw new Error("Não foi possível autenticar para criar a sala (sem currentUser).");
  }

  const code = room.code;
  const roomRef = getRoomRef(code);
  const existing = await getDoc(roomRef);

  if (existing.exists()) {
    throw new Error("Código já em uso. Tente criar a sala novamente.");
  }

  // Preserve the profile info (names, formation) the user chose,
  // but FORCE the identity (id, hostId, participantIds) to the live auth UID.
  // This guarantees the Firestore create rules will pass.
  const hostProfile = (room.participants && room.participants[0]) || {};
  const canonicalHost = stampParticipantPresence({
    ...hostProfile,
    id: liveUid,
    isHost: true,
  });

  const canonicalParticipants = [canonicalHost];
  const canonicalParticipantIds = [liveUid];

  // Build a clean payload instead of spreading the entire client room object.
  // This avoids sending extra setup state that could interfere with rule evaluation.
  const cleanConfig = room.config ? { ...room.config } : {};
  if (cleanConfig.onlineMode === "duel") {
    cleanConfig.maxPlayers = 2;
  } else {
    cleanConfig.maxPlayers = cleanConfig.maxPlayers || 20;
  }

  const payload = {
    id: room.code,
    code: room.code,
    roomName: room.roomName || "Sala 38–0",
    status: "lobby",
    hostId: liveUid,
    config: cleanConfig,
    participants: canonicalParticipants,
    participantIds: canonicalParticipantIds,
    draftOrder: [],
    draftState: null,
    isDrawingOrder: false,
    rollingParticipant: "",
    leagueResult: null,
    leagueResultStored: false,
    duelResult: null,
    revealedRounds: 0,
    liveRound: null,
    duelLive: null,
    liveSpeed: room.liveSpeed || "normal",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };



  try {
    await setDoc(roomRef, payload);
    console.log("[createRoom] setDoc succeeded for", code);
  } catch (err) {
    console.error("[createRoom] setDoc FAILED", {
      code: err?.code,
      message: err?.message,
      fullError: err,
    });
    throw err;
  }

  rememberActiveRoomCode(code);
  return { ...payload };
}

export async function patchRoomDocument(code, updates) {
  await ensureAnonymousAuth();

  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode) return;

  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, v]) => v !== undefined)
  );
  await updateDoc(getRoomRef(normalizedCode), {
    ...cleanUpdates,
    updatedAt: serverTimestamp(),
  });
}

export async function saveOnlineLeagueResult(code, leagueResult) {
  await ensureAnonymousAuth();

  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode || !leagueResult) return;

  const cleanLeagueResult = removeUndefinedDeep(leagueResult); // safe guard
  await setDoc(getLeagueResultRef(normalizedCode), {
    leagueResult: cleanLeagueResult,
    updatedAt: serverTimestamp(),
  });
}

export async function clearOnlineLeagueResult(code) {
  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode) return;

  try {
    await deleteDoc(getLeagueResultRef(normalizedCode));
  } catch (error) {
    if (error?.code !== "not-found") {
      throw error;
    }
  }
}

export async function deleteRoomDocument(code) {
  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode) return;

  await clearOnlineLeagueResult(normalizedCode);

  try {
    await deleteDoc(getRoomRef(normalizedCode));
  } catch (error) {
    if (error?.code !== "not-found") {
      throw error;
    }
  }
}

export async function touchParticipantPresence(code, participantId) {
  await ensureAnonymousAuth();

  const normalizedCode = normalizeRoomCode(code);
  const normalizedParticipantId = String(participantId || "").trim();
  if (!normalizedCode || !normalizedParticipantId) return;

  const roomRef = getRoomRef(normalizedCode);

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) return;

    const room = snapshot.data();
    const participants = (room.participants || []).map((participant) =>
      participant.id === normalizedParticipantId
        ? { ...participant, lastSeen: Date.now() }
        : participant
    );

    if (!participants.some((participant) => participant.id === normalizedParticipantId)) {
      return;
    }

    transaction.update(roomRef, {
      participants,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function pruneStaleParticipants(code, maxInactiveMs = ONLINE_PRESENCE_STALE_MS) {
  await ensureAnonymousAuth();

  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode) return "missing";

  const roomRef = getRoomRef(normalizedCode);
  let shouldDeleteRoom = false;
  const now = Date.now();

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);
    if (!snapshot.exists()) return;

    const room = snapshot.data();
    const activeParticipants = (room.participants || []).filter((participant) => {
      if (!participant.lastSeen) return true;
      return now - participant.lastSeen < maxInactiveMs;
    });

    if (activeParticipants.length === (room.participants || []).length) {
      return;
    }

    if (!activeParticipants.length) {
      shouldDeleteRoom = true;
      transaction.delete(roomRef);
      return;
    }

    const hostStillPresent = activeParticipants.some((participant) => participant.id === room.hostId);
    const nextHostId = hostStillPresent ? room.hostId : activeParticipants[0].id;
    const nextParticipants = normalizeParticipants(activeParticipants, nextHostId);

    transaction.update(roomRef, {
      participants: nextParticipants,
      participantIds: getParticipantIds(nextParticipants),
      hostId: nextHostId,
      updatedAt: serverTimestamp(),
    });
  });

  if (shouldDeleteRoom) {
    await clearOnlineLeagueResult(normalizedCode);
    return "deleted";
  }

  return "pruned";
}

export async function leaveRoomDocument(code, participantId) {
  await ensureAnonymousAuth();

  const normalizedCode = normalizeRoomCode(code);
  const normalizedParticipantId = String(participantId || "").trim();

  if (!normalizedCode || !normalizedParticipantId) return "missing";

  const roomRef = getRoomRef(normalizedCode);
  let shouldDeleteRoom = false;

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);

    if (!snapshot.exists()) {
      return;
    }

    const room = snapshot.data();
    const participants = (room.participants || []).filter(
      (participant) => participant.id !== normalizedParticipantId
    );

    if (!participants.length) {
      shouldDeleteRoom = true;
      transaction.delete(roomRef);
      return;
    }

    const hostLeft = room.hostId === normalizedParticipantId;
    const nextHostId = hostLeft ? participants[0].id : room.hostId;
    const nextParticipants = normalizeParticipants(participants, nextHostId);

    transaction.update(roomRef, {
      participants: nextParticipants,
      participantIds: getParticipantIds(nextParticipants),
      hostId: nextHostId,
      updatedAt: serverTimestamp(),
    });
  });

  if (shouldDeleteRoom) {
    await clearOnlineLeagueResult(normalizedCode);
    clearActiveRoomCode();
    return "deleted";
  }

  return "left";
}

export async function joinRoomDocument(code, participant) {
  await ensureAnonymousAuth();

  // Small delay for token propagation (same as create)
  await new Promise((resolve) => setTimeout(resolve, 120));

  const liveUid = auth.currentUser?.uid;

  if (!liveUid) {
    throw new Error("Não foi possível autenticar para entrar na sala.");
  }

  const normalizedCode = normalizeRoomCode(code);
  const roomRef = getRoomRef(normalizedCode);

  // Force the joining participant's id to the live auth UID so the
  // isJoiningLobby() rule (and general update rules) will allow the write.
  const canonicalParticipant = stampParticipantPresence({
    ...participant,
    id: liveUid,
  });



  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);

    if (!snapshot.exists()) {
      throw new Error("Sala não encontrada. Confira o código e tente de novo.");
    }

    const room = snapshot.data();

    if (room.status !== "lobby") {
      throw new Error("Essa sala já está em andamento. Só é possível entrar no lobby.");
    }

    const maxPlayers = room.config?.onlineMode === "duel" ? 2 : room.config?.maxPlayers;
    const participants = room.participants || [];

    if (participants.some((entry) => entry.id === canonicalParticipant.id)) {
      return;
    }

    if (participants.length >= maxPlayers) {
      throw new Error("A sala já está cheia.");
    }

    const nextParticipants = [...participants, canonicalParticipant];

    transaction.update(roomRef, {
      participants: nextParticipants,
      participantIds: getParticipantIds(nextParticipants),
      updatedAt: serverTimestamp(),
    });
  });

  rememberActiveRoomCode(normalizedCode);
}

export function subscribeToRoom(code, onRoomChange, onError) {
  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode) return () => {};

  let latestRoom = null;
  let latestLeagueResult = null;
  let leagueFetchStarted = false;
  let cancelled = false;

  const emit = () => {
    if (!latestRoom) {
      onRoomChange(null);
      return;
    }

    onRoomChange({
      ...latestRoom,
      leagueResult: latestLeagueResult,
    });
  };

  const fetchLeagueResultOnce = async () => {
    if (leagueFetchStarted || cancelled) return;

    leagueFetchStarted = true;

    try {
      const snapshot = await getDoc(getLeagueResultRef(normalizedCode));
      if (cancelled) return;

      latestLeagueResult = snapshot.exists() ? snapshot.data().leagueResult || null : null;
      emit();
    } catch (error) {
      leagueFetchStarted = false;
      if (onError) onError(error);
    }
  };

  const unsubscribeRoom = onSnapshot(
    getRoomRef(normalizedCode),
    (snapshot) => {
      if (!snapshot.exists()) {
        latestRoom = null;
        latestLeagueResult = null;
        leagueFetchStarted = false;
        onRoomChange(null);
        return;
      }

      latestRoom = { id: snapshot.id, ...snapshot.data() };

      // Always emit promptly on room updates so screen can react to status changes (e.g. league start)
      // immediately. For league, we also trigger background fetch of the subdoc result if needed.
      // This ensures non-hosts switch out of the post-draft "teams" screen without waiting for the subdoc.
      if (latestRoom.leagueResultStored && !latestLeagueResult && !leagueFetchStarted) {
        fetchLeagueResultOnce();
      }

      if (!latestRoom.leagueResultStored) {
        latestLeagueResult = latestRoom.leagueResult || null;
      }

      emit();
    },
    (error) => {
      if (onError) onError(error);
    }
  );

  return () => {
    cancelled = true;
    unsubscribeRoom();
  };
}

export async function applyRoomTransaction(code, mutator) {
  await ensureAnonymousAuth();

  const normalizedCode = normalizeRoomCode(code);
  const roomRef = getRoomRef(normalizedCode);

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(roomRef);

    if (!snapshot.exists()) {
      throw new Error("Sala não encontrada.");
    }

    const room = { id: snapshot.id, ...snapshot.data() };
    const nextRoom = await mutator(room);

    if (!nextRoom) return room;

    transaction.update(roomRef, {
      ...nextRoom,
      updatedAt: serverTimestamp(),
    });

    return { ...room, ...nextRoom };
  });
}