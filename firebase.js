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
  const roomCode = Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase();

  const roomRef = doc(db, "rooms", roomCode);
  const existingRoom = await getDoc(roomRef);

  if (existingRoom.exists()) {
    return createRoom(user, playerName);
  }

  await setDoc(roomRef, {
    roomCode,
    createdBy: user.uid,
    status: "waiting",
    playerCount: 1,
    createdAt: serverTimestamp()
  });

  await setDoc(doc(db, "rooms", roomCode, "players", user.uid), {
    uid: user.uid,
    displayName: playerName,
    online: true,
    score: 0,
    joinedAt: serverTimestamp()
  });

  return roomCode;
    }
