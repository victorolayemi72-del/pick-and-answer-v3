import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged as authStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, orderBy, limit, onSnapshot, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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
export { collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, orderBy, limit, onSnapshot, serverTimestamp, runTransaction };

export function normalizeProfile(p={}) {
  return {displayName:String(p.displayName||"").trim().slice(0,24),photoURL:typeof p.photoURL==="string"?p.photoURL:"",avatar:typeof p.avatar==="string"&&p.avatar?p.avatar:"🐼"};
}
export async function saveProfile(uid,p={}) {
  if(!uid) throw new Error("Please wait for sign-in to finish.");
  const profile=normalizeProfile(p);
  if(profile.displayName.length<2) throw new Error("Enter a name with at least 2 characters.");
  if(profile.photoURL.length>250000) throw new Error("Picture too large. Choose a smaller picture.");
  await setDoc(doc(db,"users",uid),{uid,...profile,updatedAt:serverTimestamp()},{merge:true});
  return profile;
}
export async function loadProfile(uid) {
  const s=await getDoc(doc(db,"users",uid)); return s.exists()?normalizeProfile(s.data()):null;
}
export async function createRoom(profile) {
  const user=auth.currentUser;if(!user)throw new Error("Please wait for sign-in to finish.");
  const p=normalizeProfile(profile);
  for(let i=0;i<30;i++){
    const code=Math.random().toString(36).slice(2,8).toUpperCase();if(!/^[A-Z0-9]{6}$/.test(code))continue;
    const ref=doc(db,"rooms",code);if((await getDoc(ref)).exists())continue;
    await setDoc(ref,{code,createdBy:user.uid,playerCount:1,status:"waiting",createdAt:serverTimestamp()});
    await setDoc(doc(db,"rooms",code,"players",user.uid),{uid:user.uid,...p,joinedAt:serverTimestamp()});
    return code;
  }
  throw new Error("Could not create a room. Try again.");
}
export async function joinRoom(code,profile) {
  const user=auth.currentUser;if(!user)throw new Error("Please wait for sign-in to finish.");
  code=String(code||"").trim().toUpperCase();if(!/^[A-Z0-9]{6}$/.test(code))throw new Error("Enter a valid six-character room code.");
  const p=normalizeProfile(profile),roomRef=doc(db,"rooms",code),playerRef=doc(db,"rooms",code,"players",user.uid);
  await runTransaction(db,async tx=>{
    const r=await tx.get(roomRef);if(!r.exists())throw new Error("Room not found. Check the code.");
    const data=r.data();if(data.status!=="waiting")throw new Error("This game has already started.");
    const existing=await tx.get(playerRef);if(existing.exists())return;
    if(Number(data.playerCount||0)>=2)throw new Error("This room already has two players.");
    tx.set(playerRef,{uid:user.uid,...p,joinedAt:serverTimestamp()});tx.update(roomRef,{playerCount:2});
  });return code;
}
export async function addRoomQuestion(code,text,category) {
  const u=auth.currentUser,r=await getDoc(doc(db,"rooms",code));
  if(!u||!r.exists()||r.data().createdBy!==u.uid)throw new Error("Only the room creator can add questions.");
  if(r.data().status!=="waiting")throw new Error("Questions cannot be changed after the game starts.");
  text=String(text||"").trim();category=String(category||"General").trim()||"General";
  if(!text)throw new Error("Type a question first.");
  await addDoc(collection(db,"rooms",code,"roomQuestions"),{text:text.slice(0,1000),category:category.slice(0,40),createdBy:u.uid,createdAt:serverTimestamp()});
}
export async function deleteRoomQuestion(code,id) {
  const u=auth.currentUser,r=await getDoc(doc(db,"rooms",code));
  if(!u||!r.exists()||r.data().createdBy!==u.uid)throw new Error("Only the room creator can delete questions.");
  if(r.data().status!=="waiting")throw new Error("Questions cannot be changed after the game starts.");
  await deleteDoc(doc(db,"rooms",code,"roomQuestions",id));
}
export async function startGame(code,category) {
  const u=auth.currentUser,roomRef=doc(db,"rooms",code),r=await getDoc(roomRef);
  if(!u||!r.exists())throw new Error("Room not found.");
  if(r.data().createdBy!==u.uid)throw new Error("Only the room creator can start the game.");
  if(r.data().status!=="waiting")throw new Error("This game has already started.");
  const players=await getDocs(collection(db,"rooms",code,"players"));
  if(players.size!==2)throw new Error("Two players must join before starting.");
  const qs=await getDocs(query(collection(db,"rooms",code,"roomQuestions"),orderBy("createdAt","asc")));
  let questions=qs.docs.map(d=>({id:d.id,text:String(d.data().text||""),category:String(d.data().category||"General")})).filter(q=>q.text);
  if(category&&category!=="__ALL__")questions=questions.filter(q=>q.category===category);
  if(!questions.length)throw new Error("No questions available for this category. Add questions first.");
  // Store the selected question snapshot in game state so both players see the same order.
  const order=players.docs.map(d=>d.id);
  await setDoc(doc(db,"rooms",code,"gameState","current"),{status:"playing",playerOrder:order,currentPlayerUid:order[0],currentQuestionIndex:0,questions,turnEndsAt:Date.now()+30000,turnStartedAt:Date.now(),lastFeedback:"Game started!",startedAt:serverTimestamp()});
  await updateDoc(roomRef,{status:"playing"});
}
