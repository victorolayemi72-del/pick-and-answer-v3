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
  collection,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  // Copy the actual values from your existing firebase.js.
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
  const name = playerName.trim();

  if (!user?.uid) throw new Error("Please sign in first.");
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
      if (error.message !== "ROOM_CODE_TAKEN") throw error;
    }
  }

  throw new Error("Could not create a room. Please try again.");
}

export async function joinRoom(user, playerName, roomCode) {
  const name = playerName.trim();
  const code = roomCode.trim().toUpperCase();

  if (!user?.uid) throw new Error("Please sign in first.");

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
      callback(snapshot.docs.map((item) => item.data()));
    },
    (error) => {
      if (onError) onError(error);
      else console.error(error);
    }
  );
}

export async function getRoom(roomCode) {
  const roomRef = doc(
    db,
    "rooms",
    roomCode.trim().toUpperCase()
  );

  const snapshot = await getDoc(roomRef);

  if (!snapshot.exists()) throw new Error("Room not found.");

  return snapshot.data();
}

export async function startGame(user, roomCode) {
  if (!user?.uid) throw new Error("Please sign in first.");

  const code = roomCode.trim().toUpperCase();
  const roomRef = doc(db, "rooms", code);
  const stateRef = doc(db, "rooms", code, "gameState", "current");
  const playerRef = doc(db, "rooms", code, "players", user.uid);

  await runTransaction(db, async (transaction) => {
    const roomSnapshot = await transaction.get(roomRef);
    const playerSnapshot = await transaction.get(playerRef);
    const stateSnapshot = await transaction.get(stateRef);

    if (!roomSnapshot.exists()) {
      throw new Error("Room not found.");
    }

    if (!playerSnapshot.exists()) {
      throw new Error("You are not a player in this room.");
    }

    if (roomSnapshot.data().playerCount !== 2) {
      throw new Error("Both players must join before starting.");
    }

    if (stateSnapshot.exists()) {
      if (stateSnapshot.data().status === "playing") {
        throw new Error("The game has already started!");
      }

      throw new Error("A game state already exists for this room.");
    }

    transaction.set(stateRef, {
      status: "playing",
      currentQuestionIndex: 0,
      currentPlayerUid: roomSnapshot.data().createdBy,
      player1Score: 0,
      player2Score: 0,
      startedBy: user.uid,
      startedAt: serverTimestamp()
    });
  });
}

export function watchGameState(roomCode, callback, onError) {
  const stateRef = doc(
    db,
    "rooms",
    roomCode.trim().toUpperCase(),
    "gameState",
    "current"
  );

  return onSnapshot(
    stateRef,
    (snapshot) => {
      callback(snapshot.exists() ? snapshot.data() : null);
    },
    (error) => {
      if (onError) onError(error);
      else console.error(error);
    }
  );
}
