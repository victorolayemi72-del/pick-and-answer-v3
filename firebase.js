import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged as authStateChanged, GoogleAuthProvider,
  signInWithPopup, signInWithRedirect, getRedirectResult, signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  deleteDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp,
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
export const onAuthStateChanged = authStateChanged;
export {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, runTransaction,
  signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut
};

export function normalizeProfile(profile = {}) {
  return {
    displayName: String(profile.displayName || "").trim().slice(0, 24),
    photoURL: typeof profile.photoURL === "string" ? profile.photoURL : "",
    avatar: typeof profile.avatar === "string" && profile.avatar ? profile.avatar : "🐼"
  };
}
export async function saveProfile(uid, profile = {}) {
  if (!uid) throw new Error("Please wait for sign-in to finish.");
  const normalized = normalizeProfile(profile);
  if (normalized.displayName.length < 2) throw new Error("Enter a name with at least 2 characters.");
  if (normalized.photoURL.length > 250000) throw new Error("Picture too large. Choose a smaller picture.");
  await setDoc(doc(db, "users", uid), { uid, ...normalized, updatedAt: serverTimestamp() }, { merge: true });
  return normalized;
}
export async function loadProfile(uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? normalizeProfile(snap.data()) : null;
}
export async function createRoom(profile) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please wait for sign-in to finish.");
  const normalized = normalizeProfile(profile);
  if (normalized.displayName.length < 2) throw new Error("Save your display name first.");
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) continue;
    const roomRef = doc(db, "rooms", code);
    if ((await getDoc(roomRef)).exists()) continue;
    await setDoc(roomRef, { code, createdBy: user.uid, playerCount: 1, status: "waiting", createdAt: serverTimestamp() });
    await setDoc(doc(db, "rooms", code, "players", user.uid), { uid: user.uid, ...normalized, joinedAt: serverTimestamp() });
    return code;
  }
  throw new Error("Could not create a room. Please try again.");
}
export async function joinRoom(code, profile) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please wait for sign-in to finish.");
  code = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error("Enter a valid six-character room code.");
  const normalized = normalizeProfile(profile);
  const roomRef = doc(db, "rooms", code);
  const playerRef = doc(db, "rooms", code, "players", user.uid);
  await runTransaction(db, async tx => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists()) throw new Error("Room not found. Check the room code.");
    const room = roomSnap.data();
    if (room.status !== "waiting") throw new Error("This game has already started.");
    const playerSnap = await tx.get(playerRef);
    if (playerSnap.exists()) return;
    if (Number(room.playerCount || 0) >= 2) throw new Error("This room already has two players.");
    tx.set(playerRef, { uid: user.uid, ...normalized, joinedAt: serverTimestamp() });
    tx.update(roomRef, { playerCount: 2 });
  });
  return code;
}
export async function startGame(code) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please wait for sign-in to finish.");
  const roomRef = doc(db, "rooms", code);
  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists()) throw new Error("Room not found.");
  if (roomSnap.data().createdBy !== user.uid) throw new Error("Only the room creator can start the game.");
  if (roomSnap.data().status !== "waiting") throw new Error("This game has already started.");
  const playerSnap = await getDocs(collection(db, "rooms", code, "players"));
  if (playerSnap.size !== 2) throw new Error("Two players must join before starting.");
  const qSnap = await getDocs(query(collection(db, "questions"), limit(500)));
  const questions = qSnap.docs.map(s => {
    const d = s.data();
    return { id: s.id, text: String(d.text ?? d.question ?? ""), category: String(d.category ?? "General"),
      options: Array.isArray(d.options) ? d.options : [], answer: d.answer ?? d.correctAnswer, active: d.active !== false };
  }).filter(q => q.text && q.active && Array.isArray(q.options) && q.options.length >= 2);
  if (!questions.length) throw new Error("No active questions found. Ask the admin to add questions first.");
  questions.sort(() => Math.random() - .5);
  const selected = questions.slice(0, Math.min(20, questions.length));
  const order = playerSnap.docs.map(p => p.id);
  await setDoc(doc(db, "rooms", code, "gameState", "current"), {
    status: "playing", playerOrder: order, currentPlayerUid: order[0], currentQuestionIndex: 0,
    questionIds: selected.map(q => q.id), questions: selected,
    scores: Object.fromEntries(order.map(id => [id, 0])), answered: false,
    turnEndsAt: Date.now() + 30000, startedAt: serverTimestamp()
  });
  await updateDoc(roomRef, { status: "playing" });
  return true;
}
