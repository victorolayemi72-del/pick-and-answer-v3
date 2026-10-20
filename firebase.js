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
  getDocs,
  collection,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

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
        const existing = await transaction.get(roomRef);

        if (existing.exists()) {
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

export async function loadQuestions() {
  const snapshot = await getDocs(collection(db, "questions"));

  const questions = snapshot.docs.map((item) => {
    const data = item.data();

    return {
      id: item.id,
      category: data.category || "General",
      text:
        data.question ||
        data.questionText ||
        data.text ||
        data.title ||
        "",
      options: Array.isArray(data.options)
        ? data.options
        : [
            data.optionA || data.A,
            data.optionB || data.B,
            data.optionC || data.C,
            data.optionD || data.D
          ].filter(Boolean),
      answer: data.correctAnswer || data.answer || "",
      ...data
    };
  }).filter((question) => question.text);

  if (questions.length === 0) {
    throw new Error(
      "No readable questions found in Firebase. Check the question fields."
    );
  }

  return questions;
}

export function watchRoomPlayers(roomCode, callback, onError) {
  return onSnapshot(
    collection(db, "rooms", roomCode.toUpperCase(), "players"),
    (snapshot) => callback(snapshot.docs.map((item) => item.data())),
    (error) => onError?.(error)
  );
}

export async function startGame(user, roomCode) {
  if (!user?.uid) throw new Error("Please sign in first.");

  const questions = await loadQuestions();

  for (let i = questions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [questions[i], questions[j]] = [questions[j], questions[i]];
  }

  const selectedQuestions = questions.slice(0, 20);
  const code = roomCode.toUpperCase();

  const roomRef = doc(db, "rooms", code);
  const playerRef = doc(db, "rooms", code, "players", user.uid);
  const stateRef = doc(db, "rooms", code, "gameState", "current");

  await runTransaction(db, async (transaction) => {
    const roomSnapshot = await transaction.get(roomRef);
    const playerSnapshot = await transaction.get(playerRef);
    const stateSnapshot = await transaction.get(stateRef);

    if (!roomSnapshot.exists()) throw new Error("Room not found.");

    if (!playerSnapshot.exists()) {
      throw new Error("You are not a player in this room.");
    }

    if (roomSnapshot.data().playerCount !== 2) {
      throw new Error("Both players must join first.");
    }

    if (stateSnapshot.exists()) {
      throw new Error("A game has already started in this room.");
    }

    transaction.set(stateRef, {
      status: "playing",
      currentQuestionIndex: 0,
      currentPlayerUid: roomSnapshot.data().createdBy,
      questionIds: selectedQuestions.map((question) => question.id),
      player1Score: 0,
      player2Score: 0,
      startedBy: user.uid,
      startedAt: serverTimestamp()
    });
  });
}

export function watchGameState(roomCode, callback, onError) {
  return onSnapshot(
    doc(db, "rooms", roomCode.toUpperCase(), "gameState", "current"),
    (snapshot) => callback(snapshot.exists() ? snapshot.data() : null),
    (error) => onError?.(error)
  );
}
