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

function normalizeProfile(profile = {}) {
  return {
    displayName: String(profile.displayName || "").trim().slice(0, 30),
    photoURL: typeof profile.photoURL === "string"
      ? profile.photoURL
      : "",
    avatar: typeof profile.avatar === "string" && profile.avatar
      ? profile.avatar
      : "🐼"
  };
}

// Save profile
export async function saveProfile(uid, profile = {}) {
  if (!uid) {
    throw new Error("Please wait for sign-in to finish.");
  }

  const normalized = normalizeProfile(profile);

  if (normalized.displayName.length < 2) {
    throw new Error("Enter a name with at least 2 characters.");
  }

  if (normalized.photoURL.length > 250000) {
    throw new Error("Picture too large. Please choose another picture.");
  }

  await setDoc(doc(db, "users", uid), {
    uid,
    ...normalized,
    updatedAt: serverTimestamp()
  }, { merge: true });

  return normalized;
}

// Load profile
export async function loadProfile(uid) {
  if (!uid) return null;

  const snapshot = await getDoc(doc(db, "users", uid));

  return snapshot.exists()
    ? normalizeProfile(snapshot.data())
    : null;
}

// Create a private room
export async function createRoom(profile) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Please wait for sign-in to finish.");
  }

  const normalized = normalizeProfile(profile);

  if (normalized.displayName.length < 2) {
    throw new Error("Enter your display name first.");
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase();

    if (!/^[A-Z0-9]{6}$/.test(code)) continue;

    const roomRef = doc(db, "rooms", code);
    const existing = await getDoc(roomRef);

    if (existing.exists()) continue;

    await setDoc(roomRef, {
      code,
      createdBy: user.uid,
      playerCount: 1,
      status: "waiting",
      createdAt: serverTimestamp()
    });

    await setDoc(
      doc(db, "rooms", code, "players", user.uid),
      {
        uid: user.uid,
        ...normalized,
        joinedAt: serverTimestamp()
      }
    );

    return code;
  }

  throw new Error("Could not create a room. Please try again.");
}

// Join a private room
export async function joinRoom(code, profile) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Please wait for sign-in to finish.");
  }

  code = String(code || "").trim().toUpperCase();

  if (!/^[A-Z0-9]{6}$/.test(code)) {
    throw new Error("Enter a valid six-character room code.");
  }

  const normalized = normalizeProfile(profile);
  const roomRef = doc(db, "rooms", code);
  const playerRef = doc(db, "rooms", code, "players", user.uid);

  await runTransaction(db, async transaction => {
    const roomSnapshot = await transaction.get(roomRef);

    if (!roomSnapshot.exists()) {
      throw new Error("Room not found. Check the room code.");
    }

    const room = roomSnapshot.data();

    if (room.status !== "waiting") {
      throw new Error("This game has already started.");
    }

    const playerSnapshot = await transaction.get(playerRef);

    if (playerSnapshot.exists()) return;

    if (Number(room.playerCount || 0) >= 2) {
      throw new Error("This room already has two players.");
    }

    transaction.set(playerRef, {
      uid: user.uid,
      ...normalized,
      joinedAt: serverTimestamp()
    });

    transaction.update(roomRef, {
      playerCount: 2
    });
  });

  return code;
}

// Start a game
export async function startGame(code) {
  if (!auth.currentUser) {
    throw new Error("Please wait for sign-in to finish.");
  }

  const roomRef = doc(db, "rooms", code);

  const roomSnapshot = await getDoc(roomRef);

  if (!roomSnapshot.exists()) {
    throw new Error("Room not found.");
  }

  if (roomSnapshot.data().createdBy !== auth.currentUser.uid) {
    throw new Error("Only the room creator can start the game.");
  }

  if (roomSnapshot.data().status !== "waiting") {
    throw new Error("This game has already started.");
  }

  const playersSnapshot = await getDocs(
    collection(db, "rooms", code, "players")
  );

  if (playersSnapshot.size !== 2) {
    throw new Error("Two players must join before starting.");
  }

  const playerOrder = playersSnapshot.docs.map(player => player.id);

  const questionsSnapshot = await getDocs(
    query(collection(db, "questions"), limit(500))
  );

  const questions = questionsSnapshot.docs
    .map(snapshot => {
      const data = snapshot.data();

      const text = data.text ?? data.Text ?? data.question ?? data.Question;
      const category = data.category ?? data.Category ?? "General";
      const options = data.options ?? data.Options ?? [];
      const answer = data.answer ?? data.Answer ?? data.correctAnswer;

      const active = data.active ?? data.Active ?? true;

      return {
        id: snapshot.id,
        text: typeof text === "string" ? text : "",
        category,
        options: Array.isArray(options) ? options : [],
        answer,
        active
      };
    })
    .filter(question =>
      question.text &&
      question.active !== false &&
      question.active !== "false"
    );

  if (!questions.length) {
    throw new Error("No active questions were found in Firestore.");
  }

  // Randomize the questions and use up to 20.
  questions.sort(() => Math.random() - 0.5);

  const selected = questions.slice(0, 20);

  const stateRef = doc(db, "rooms", code, "gameState", "current");

  await setDoc(stateRef, {
    status: "playing",
    playerOrder,
    currentPlayerUid: playerOrder[0],
    currentQuestionIndex: 0,
    questionIds: selected.map(question => question.id),
    questions: selected,
    scores: Object.fromEntries(playerOrder.map(id => [id, 0])),
    turnEndsAt: Date.now() + 30000,
    startedAt: serverTimestamp()
  });

  await updateDoc(roomRef, {
    status: "playing"
  });

  return true;
}
