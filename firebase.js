import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// IMPORTANT: Use your real Firebase configuration values.
const firebaseConfig = {
  apiKey: "AIzaSyBPz1I-mkNjn7omzVFJtWT-YAmMqplKm6o",
  authDomain: "pick-and-answer-v3.firebaseapp.com",
  projectId: "pick-and-answer-v3",
  storageBucket: "pick-and-answer-v3.firebasestorage.app",
  messagingSenderId: "507310495702",
  appId: "1:507310495702:web:02a3313c286d741803b677"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export async function signInGuest() {
  await setPersistence(auth, browserLocalPersistence);
  const result = await signInAnonymously(auth);
  return result.user;
}

function generateRoomCode() {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < 6; i++) {
    code += characters[Math.floor(Math.random() * characters.length)];
  }

  return code;
}

export async function createRoom(user, playerName) {
  if (!user?.uid) {
    throw new Error("Please sign in first.");
  }

  const name = playerName.trim();

  if (!name || name.length > 25) {
    throw new Error("Enter a name between 1 and 25 characters.");
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const roomCode = generateRoomCode();
    const roomRef = doc(db, "rooms", roomCode);
    const playerRef = doc(db, "rooms", roomCode, "players", user.uid);

    try {
      await runTransaction(db, async (transaction) => {
        const roomSnapshot = await transaction.get(roomRef);

        if (roomSnapshot.exists()) {
          throw new Error("ROOM_CODE_TAKEN");
        }

        transaction.set(roomRef, {
          roomCode,
          createdBy: user.uid,
          status: "waiting",
          playerCount: 1,
          createdAt: serverTimestamp()
        });

        transaction.set(playerRef, {
          uid: user.uid,
          displayName: name,
          online: true,
          score: 0,
          joinedAt: serverTimestamp()
        });
      });

      return roomCode;
    } catch (error) {
      if (error.message !== "ROOM_CODE_TAKEN") {
        throw error;
      }
    }
  }

  throw new Error("Could not create a room. Please try again.");
}

export async function joinRoom(user, playerName, roomCode) {
  if (!user?.uid) {
    throw new Error("Please sign in first.");
  }

  const name = playerName.trim();
  const code = roomCode.trim().toUpperCase();

  if (!name || name.length > 25) {
    throw new Error("Enter a name between 1 and 25 characters.");
  }

  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
    throw new Error("Enter a valid six-character room code.");
  }

  const roomRef = doc(db, "rooms", code);
  const playerRef = doc(db, "rooms", code, "players", user.uid);

  await runTransaction(db, async (transaction) => {
    const roomSnapshot = await transaction.get(roomRef);

    if (!roomSnapshot.exists()) {
      throw new Error("Room not found. Check the code.");
    }

    const playerSnapshot = await transaction.get(playerRef);
    const room = roomSnapshot.data();

    if (playerSnapshot.exists()) {
      throw new Error("You have already joined this room.");
    }

    if (room.status !== "waiting") {
      throw new Error("This room is no longer accepting players.");
    }

    if (room.playerCount >= 2) {
      throw new Error("This room already has two players.");
    }

    transaction.set(playerRef, {
      uid: user.uid,
      displayName: name,
      online: true,
      score: 0,
      joinedAt: serverTimestamp()
    });

    transaction.update(roomRef, {
      playerCount: room.playerCount + 1
    });
  });

  return code;
}

export function watchRoomPlayers(roomCode, callback, onError) {
  const playersRef = collection(
    db,
    "rooms",
    roomCode.trim().toUpperCase(),
    "players"
  );

  return onSnapshot(
    playersRef,
    (snapshot) => {
      const players = snapshot.docs.map((player) => player.data());
      callback(players);
    },
    (error) => {
      if (onError) onError(error);
      else console.error(error);
    }
  );
}

export async function getRoom(roomCode) {
  const roomRef = doc(db, "rooms", roomCode.trim().toUpperCase());
  const snapshot = await getDoc(roomRef);

  if (!snapshot.exists()) {
    throw new Error("Room not found.");
  }

  return snapshot.data();
}
