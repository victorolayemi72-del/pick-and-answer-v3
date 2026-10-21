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

export async function saveProfile(uid, profile) {
  await setDoc(
    doc(db, "users", uid),
    {
      uid,
      displayName: profile.displayName,
      photoURL: profile.photoURL || "",
      avatar: profile.avatar || "🐼",
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

export async function loadProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

export async function createRoom(profile) {
  const uid = auth.currentUser.uid;

  for (let i = 0; i < 8; i++) {
    const code = Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase();

    const roomRef = doc(db, "rooms", code);
    const existing = await getDoc(roomRef);

    if (!existing.exists()) {
      await setDoc(roomRef, {
        code,
        createdBy: uid,
        playerCount: 1,
        status: "waiting",
        createdAt: serverTimestamp()
      });

      await setDoc(doc(db, "rooms", code, "players", uid), {
        uid,
        displayName: profile.displayName,
        photoURL: profile.photoURL || "",
        avatar: profile.avatar || "🐼",
        joinedAt: serverTimestamp()
      });

      return code;
    }
  }

  throw new Error("Could not create a room. Try again.");
}

export async function joinRoom(code, profile) {
  const uid = auth.currentUser.uid;
  code = code.trim().toUpperCase();

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

    const playerRef = doc(db, "rooms", code, "players", uid);
    const player = await tx.get(playerRef);

    if (player.exists()) return;

    if (room.data().playerCount >= 2) {
      throw new Error("This private room already has two players.");
    }

    tx.set(playerRef, {
      uid,
      displayName: profile.displayName,
      photoURL: profile.photoURL || "",
      avatar: profile.avatar || "🐼",
      joinedAt: serverTimestamp()
    });

    tx.update(roomRef, {
      playerCount: 2
    });
  });

  return code;
}

export async function startGame(code) {
  const uid = auth.currentUser.uid;

  const playersSnap = await getDocs(
    collection(db, "rooms", code, "players")
  );

  if (playersSnap.size !== 2) {
    throw new Error("Both players must join before starting.");
  }

  const roomRef = doc(db, "rooms", code);
  const roomSnap = await getDoc(roomRef);

  if (roomSnap.data()?.createdBy !== uid) {
    throw new Error("Only the room creator can start the game.");
  }

  const qs = await getDocs(
    query(collection(db, "questions"), limit(500))
  );

  const questions = qs.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(q => q.text || q.question);

  if (!questions.length) {
    throw new Error(
      "Add questions to the Firestore questions collection first."
    );
  }

  questions.sort(() => Math.random() - 0.5);

  const selected = questions.slice(0, Math.min(20, questions.length));
  const playerIds = playersSnap.docs.map(d => d.id);

  await setDoc(doc(db, "rooms", code, "gameState", "current"), {
    status: "playing",
    questionIds: selected.map(q => q.id),
    currentQuestionIndex: 0,
    currentPlayerUid: playerIds[0],
    playerOrder: playerIds,
    scores: Object.fromEntries(playerIds.map(id => [id, 0])),
    answers: {},
    skipped: [],
    startedBy: uid,
    startedAt: serverTimestamp(),
    turnEndsAt: Date.now() + 30000
  });

  await updateDoc(roomRef, {
    status: "playing"
  });
}
