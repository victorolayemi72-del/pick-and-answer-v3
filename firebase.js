import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Keep your actual Firebase configuration values here.
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

export async function createRoom(user, playerName) {
  if (!user || !user.uid) {
    throw new Error("Please sign in first.");
  }

  const name = playerName.trim();

  if (!name || name.length > 25) {
    throw new Error("Enter a name between 1 and 25 characters.");
  }

  const roomCode = crypto.randomUUID()
    .replace(/-/g, "")
    .substring(0, 6)
    .toUpperCase();

  const roomRef = doc(db, "rooms", roomCode);
  const playerRef = doc(
    db, "rooms", roomCode, "players", user.uid
  );

  await setDoc(roomRef, {
    roomCode,
    createdBy: user.uid,
    status: "waiting",
    playerCount: 1,
    createdAt: serverTimestamp()
  });

  await setDoc(playerRef, {
    uid: user.uid,
    displayName: name,
    online: true,
    score: 0,
    joinedAt: serverTimestamp()
  });

  return roomCode;
    }export async function joinRoom(user, playerName, roomCode) {
  if (!user || !user.uid) {
    throw new Error("Please sign in first.");
  }

  const name = playerName.trim();
  const code = roomCode.trim().toUpperCase();

  if (!name || name.length > 25) {
    throw new Error("Enter a valid name.");
  }

  const roomRef = doc(db, "rooms", code);
  const roomSnap = await getDoc(roomRef);

  if (!roomSnap.exists()) {
    throw new Error("Room not found. Check the code.");
  }

  const room = roomSnap.data();

  if (room.status !== "waiting") {
    throw new Error("This room is not accepting players.");
  }

  if (room.createdBy === user.uid) {
    throw new Error("You cannot join your own room as a second player.");
  }

  const playersRef = collection(db, "rooms", code, "players");
  const playerRef = doc(playersRef, user.uid);

  await setDoc(playerRef, {
    uid: user.uid,
    displayName: name,
    online: true,
    score: 0,
    joinedAt: serverTimestamp()
  });

  return code;
}
