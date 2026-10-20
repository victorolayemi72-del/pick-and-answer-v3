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
    }
