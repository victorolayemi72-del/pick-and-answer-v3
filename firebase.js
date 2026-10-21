import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBPz1I-mkNjn7omzVFJtWT-YAmMqplKm6o",
  authDomain: "pick-and-answer-v3.firebaseapp.com",
  databaseURL: "https://pick-and-answer-v3-default-rtdb.firebaseio.com",
  projectId: "pick-and-answer-v3",
  storageBucket: "pick-and-answer-v3.firebasestorage.app",
  messagingSenderId: "507310495702",
  appId: "1:507310495702:web:02a3313c286d741803b677"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export const signInGuest = () => signInAnonymously(auth);

export {
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  runTransaction
};

// Normalize profiles so the app always receives valid values.
function normalizeProfile(profile = {}) {
  return {
    displayName:
      String(profile.displayName || "").trim().slice(0, 30),

    photoURL:
      typeof profile.photoURL === "string"
        ? profile.photoURL
        : "",

    avatar:
      typeof profile.avatar === "string" && profile.avatar
        ? profile.avatar
        : "🐼"
  };
}

// SAVE PLAYER PROFILE
export async function saveProfile(uid, profile = {}) {
  if (!uid) {
    throw new Error("Please sign in before saving your profile.");
  }

  const normalized = normalizeProfile(profile);

  if (!normalized.displayName) {
    throw new Error("Enter a display name before saving.");
  }

  // Avoid storing unexpectedly large images in Firestore.
  if (normalized.photoURL.length > 250000) {
    throw new Error(
      "This picture is too large. Choose a smaller image."
    );
  }

  const profileRef = doc(db, "users", uid);

  await setDoc(
    profileRef,
    {
      uid,
      displayName: normalized.displayName,
      photoURL: normalized.photoURL,
      avatar: normalized.avatar,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  // Return the saved profile for the interface to use.
  return normalized;
}

// LOAD PLAYER PROFILE
export async function loadProfile(uid) {
  if (!uid) {
    throw new Error("Please sign in before loading your profile.");
  }

  const profileSnap = await getDoc(doc(db, "users", uid));

  if (!profileSnap.exists()) {
    return null;
  }

  return normalizeProfile(profileSnap.data());
}

// CREATE PRIVATE ROOM
export async function createRoom(profile) {
  if (!auth.currentUser) {
    throw new Error("Please wait for sign-in to finish.");
  }

  const uid = auth.currentUser.uid;
  const normalized = normalizeProfile(profile);

  if (!normalized.displayName) {
    throw new Error("Enter your display name first.");
  }

  for (let i = 0; i < 8; i++) {
    const code = Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase();

    if (code.length !== 6) continue;

    const roomRef = doc(db, "rooms", code);
    const existing = await getDoc(roomRef);

    if (existing.exists()) continue;

    await setDoc(roomRef, {
      code,
      createdBy: uid,
      playerCount: 1,
      status: "waiting",
      createdAt: serverTimestamp()
    });

    await setDoc(
      doc(db, "rooms", code, "players", uid),
      {
        uid,
        displayName: normalized.displayName,
        photoURL: normalized.photoURL,
        avatar: normalized.avatar,
        joinedAt: serverTimestamp()
      }
    );

    return code;
  }

  throw new Error("Could not create a room. Please try again.");
}

// JOIN PRIVATE ROOM
export async function joinRoom(code, profile) {
  if (!auth.currentUser) {
    throw new Error("Please wait for sign-in to finish.");
  }

  const uid = auth.currentUser.uid;
  const normalized = normalizeProfile(profile);

  if (!normalized.displayName) {
    throw new Error("Enter your display name first.");
  }

  code = String(code || "").trim().toUpperCase();

  if (!/^[A-Z0-9]{6}$/.test(code)) {
    throw new Error("Enter the six-character room code.");
  }

  const roomRef = doc(db, "rooms", code);

  await runTransaction(db, async tx => {
    const room = await tx.get(roomRef);

    if (!room.exists()) {
      throw new Error("Room not found. Check the code.");
    }

    if (room.data().status !== "waiting") {
      throw new Error("This game has already started.");
    }

    const playerRef = doc(
      db,
      "rooms",
      code,
      "players",
      uid
    );

    const
