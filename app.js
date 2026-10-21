import {
  auth, db, signInGuest, onAuthStateChanged, collection, doc, getDoc, getDocs,
  addDoc, updateDoc, setDoc, query, orderBy, limit, onSnapshot, serverTimestamp,
  saveProfile, loadProfile, createRoom, joinRoom, startGame
} from "./firebase.js";

const $ = id => document.getElementById(id);
const AVATARS = ["🐼","🐱","🐶","🦊","🐸","🐵","🐰","🐻","🐯","🦁","🐨","🐹","🐧","🦄","🐙","🦋","🌻","⭐"];
let currentUser = null, profile = {displayName:"",photoURL:"",avatar:"🐼"}, roomCode = "", roomUnsubs = [], selectedOption = null, localTimer = null, currentGame = null, gameActionBusy = false;
const safeText = value => String(value ?? "");
function notice(message, type="") {
  const el=$("notice"); el.textContent=message; el.className="notice show"+(type?" "+type:"");
}
function clearNotice(){ $("notice").className="notice"; $("notice").textContent=""; }
function avatarHTML(p, extra="") {
  if (p?.photoURL) return `<div class="avatar ${extra}"><img alt="" src="${p.photoURL}"></div>`;
  return `<div class="avatar ${extra}">${escapeHTML(p?.avatar || "🐼")}</div>`;
}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function renderMyAvatar(){ $("myAvatar").innerHTML = profile.photoURL ? `<img alt="Your profile picture" src="${profile.photoURL}">` : escapeHTML(profile.avatar || "🐼"); }
function drawAvatarChoices(){
  $("avatarChoices").innerHTML="";
  AVATARS.forEach(a=>{
    const b=document.createElement("button"); b.type="button"; b.className="avatar-choice"+(!profile.photoURL&&profile.avatar===a?" selected":""); b.textContent=a; b.title=`Use ${a}`;
    b.addEventListener("click",()=>{profile.avatar=a;profile.photoURL="";renderMyAvatar();drawAvatarChoices();$("pictureStatus").textContent=`${a} selected. Tap Save profile.`;});
    $("avatarChoices").appendChild(b);
  });
}
function getProfileFromInputs(){return {...profile,displayName:$("displayName").value.trim()};}
function stopListeners(){roomUnsubs.forEach(fn=>{try{fn()}catch{}});roomUnsubs=[];if(localTimer)clearInterval(localTimer);localTimer=null;}
function showRoomSections(){ $("chatCard").classList.remove("hidden"); $("roomLabel").textContent=`Room code: ${roomCode}`; $("roomCode").value=roomCode; }
async function compressImage(file){
  if(!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
  const source=await createImageBitmap(file);
  const canvas=document.createElement("canvas"); const side=256;
  const scale=Math.min(1,side/Math.max(source.width,source.height));
  canvas.width=Math.max(1,Math.round(source.width*scale));canvas.height=Math.max(1,Math.round(source.height*scale));
  const ctx=canvas.getContext("2d");ctx.drawImage(source,0,0,canvas.width,canvas.height);
  source.close?.();
  let data=canvas.toDataURL("image/jpeg",0.72);
  if(data.length>180000)data=canvas.toDataURL("image/jpeg",0.5);
  if(data.length>250000)throw new Error("That picture is too large. Choose another image.");
  return data;
}
$("profilePicture").addEventListener("change",async e=>{
  const file=e.target.files?.[0]; if(!file)return;
  try{$("pictureStatus").textContent="Preparing picture…";profile.photoURL=await compressImage(file);renderMyAvatar();drawAvatarChoices();$("pictureStatus").textContent="Picture selected. Tap Save profile to save it.";}
  catch(err){profile.photoURL="";$("pictureStatus").textContent=err.message;notice(err.message,"error");}
  finally{e.target.value="";}
});
$("useAvatar").addEventListener("click",()=>{profile.photoURL="";renderMyAvatar();drawAvatarChoices();$("pictureStatus").textContent="Choose an avatar below, then tap Save profile.";});
$("saveProfile").addEventListener("click",async()=>{
  clearNotice(); if(!currentUser){notice("Connecting… wait a moment and try again.");return;}
  const next=getProfileFromInputs();
  try{ $("saveProfile").disabled=true; profile=await saveProfile(currentUser.uid,next);$("displayName").value=profile.displayName;renderMyAvatar();drawAvatarChoices();$("pictureStatus").textContent="Profile saved successfully.";notice("Profile saved! You can create or join a room.","success");}
  catch(err){notice(`Profile could not be saved: ${err.message}`,"error");}
  finally{$("saveProfile").disabled=false;}
});
async function ensureSavedProfile(){
  if(!currentUser)throw new Error("Still connecting to the game. Try again in a moment.");
  const p=getProfileFromInputs();
  if(p.displayName.length<2)throw new Error("Enter a display name with at least 2 characters.");
  profile=await saveProfile(currentUser.uid,p);return profile;
}
$("createRoom").addEventListener("click",async()=>{
  clearNotice();try{const p=await ensureSavedProfile();stopListeners();roomCode=await createRoom(p);subscribeRoom();notice("Room created. Share the six-character code with one friend.","success");}
  catch(e){notice(e.message,"error");}
});
$("joinRoom").addEventListener("click",async()=>{
  clearNotice();try{const p=await ensureSavedProfile();stopListeners();roomCode=await joinRoom($("roomCode").value,p);subscribeRoom();notice("You joined the room.","success");}
  catch(e){notice(e.message,"error");}
});
$("startGame").addEventListener("click",async()=>{
  try{$("startGame").disabled=true;await startGame(roomCode);notice("Game started!","success");}
  catch(e){notice(e.message,"error");}
  finally{$("startGame").disabled=false;}
});
$("returnLobby").addEventListener("click",()=>{$("gameCard").classList.add("hidden");$("lobbyCard").classList.remove("hidden");$("returnLobby").classList.add("hidden");});
function subscribeRoom(){
  stopListeners();showRoomSections();
  roomUnsubs.push(onSnapshot(collection(db,"rooms",roomCode,"players"),snap=>{
    const players=snap.docs.map(d=>d.data());
    $("players").innerHTML=players.map(p=>`<div class="player-card">${avatarHTML(p)}<div><strong>${escapeHTML(p.displayName||"Player")}</strong><div class="muted">${p.uid===currentUser?.uid?"You":"Opponent"}</div></div></div>`).join("");
    const roomCreator=players.length && players.some(p=>p.uid===currentUser?.uid);
    $("startGame").classList.toggle("hidden",!roomCreator);
    getDoc(doc(db,"rooms",roomCode)).then(s=>{$("startGame").classList.toggle("hidden",!s.exists()||s.data().createdBy!==currentUser?.uid||s.data().status!=="waiting");}).catch(()=>{});
  },err=>notice(`Players could not load: ${err.message}`,"error")));
  roomUnsubs.push(onSnapshot(doc(db,"rooms",roomCode),snap=>{
    if(!snap.exists()){notice("This room no longer exists.","error");return;}
    const r=snap.data();$("roomLabel").textContent=`Room code: ${roomCode} · ${r.status==="playing"?"Game in progress":"Waiting for player"}`;
    if(r.status==="playing"){$("startGame").classList.add("hidden");$("gameCard").classList.remove("hidden");}
  }));
  roomUnsubs.push(onSnapshot(doc(db,"rooms",roomCode,"gameState","current"),snap=>{
    if(snap.exists()){currentGame=snap.data();$("gameCard").classList.remove("hidden");renderGame();}
  },err=>notice(`Game state error: ${err.message}`,"error")));
  roomUnsubs.push(onSnapshot(query(collection(db,"rooms",roomCode,"messages"),orderBy("createdAt","asc"),limit(100)),snap=>{
    $("chatMessages").innerHTML="";snap.forEach(d=>{const m=d.data();const div=document.createElement("div");div.className="chat-message"+(m.uid===currentUser?.uid?" mine":"");const small=document.createElement("small");small.textContent=m.displayName||"Player";const body=document.createElement("div");body.textContent=m.text||"";div.append(small,body);$("chatMessages").appendChild(div);});$("chatMessages").scrollTop=$("chatMessages").scrollHeight;
  },err=>notice(`Chat unavailable: ${err.message}`,"error")));
}
function renderScores(){
  const scores=currentGame?.scores||{};const order=currentGame?.playerOrder||[];
  $("scores").innerHTML=order.map(uid=>{const name=uid===currentUser?.uid?profile.displayName:(document.querySelector(`.player-card .muted`)?.textContent||"Player");return `<div class="score-card"><span>${uid===currentUser?.uid?"You": "Opponent"}</span><strong>${Number(scores[uid]||0)} points</strong></div>`;}).join("");
}
function renderGame(){
  if(!currentGame)return;
  const questions=currentGame.questions||[],idx=Number(currentGame.currentQuestionIndex||0),q=questions[idx];
  if(currentGame.status==="finished"||!q){
    $("questionText").textContent="Game complete! 🎉";$("category").textContent="Final results";$("options").innerHTML="";
    $("progress").textContent="Finished";$("timer").textContent="0";$("answerFeedback").textContent="Thanks for playing!";$("submitAnswer").classList.add("hidden");$("skipQuestion").classList.add("hidden");$("nextQuestion").classList.add("hidden");$("returnLobby").classList.remove("hidden");renderScores();return;
  }
  $("progress").textContent=`Question ${idx+1} of ${questions.length}`;$("questionText").textContent=q.text;$("category").textContent=q.category||"General";
  const myTurn=currentGame.currentPlayerUid===currentUser?.uid;
  const already=currentGame.answered===true;
  $("answerFeedback").textContent=currentGame.lastFeedback|| (myTurn?"Your turn — choose an answer.":"Waiting for your opponent's turn.");
  $("options").innerHTML="";
  (q.options||[]).forEach((option,i)=>{const b=document.createElement("button");b.type="button";b.className="option"+(selectedOption===i?" selected":"");b.textContent=`${String.fromCharCode(65+i)}. ${option}`;b.disabled=!myTurn||already;b.addEventListener("click",()=>{selectedOption=i;renderGame();});$("options").appendChild(b);});
  $("submitAnswer").classList.toggle("hidden",!myTurn||already);$("skipQuestion").classList.toggle("hidden",!myTurn||already);$("nextQuestion").classList.toggle("hidden",!already);
  $("submitAnswer").disabled=selectedOption===null||gameActionBusy;
  renderScores();startLocalTimer();
}
function startLocalTimer(){
  if(localTimer)clearInterval(localTimer);
  if(!currentGame||currentGame.status==="finished"||currentGame.answered)return;
  const tick=()=>{const remaining=Math.max(0,Math.ceil((Number(currentGame.turnEndsAt||Date.now())-Date.now())/1000));$("timer").textContent=String(remaining);$("timerBar").style.width=`${Math.min(100,remaining/30*100)}%`;if(remaining===0&&currentGame.currentPlayerUid===currentUser?.uid)advanceTurn("Time expired.");};
  tick();localTimer=setInterval(tick,500);
}
async function advanceTurn(feedback){
  if(gameActionBusy||!currentGame||currentGame.currentPlayerUid!==currentUser?.uid)return;
  gameActionBusy=true;
  try{
    const ref=doc(db,"rooms",roomCode,"gameState","current");
    await runSafeTurn(ref,feedback,null);
  }catch(e){notice(`Could not advance turn: ${e.message}`,"error");}
  finally{gameActionBusy=false;selectedOption=null;}
}
async function runSafeTurn(ref,feedback,chosenAnswer){
  // Read inside a transaction to prevent two clients advancing the same turn.
  const {runTransaction}=await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");
  await runTransaction(db,async tx=>{
    const snap=await tx.get(ref);if(!snap.exists())throw new Error("Game state missing.");
    const s=snap.data();if(s.currentPlayerUid!==currentUser.uid||s.answered||s.status==="finished")return;
    const qs=s.questions||[],q=qs[s.currentQuestionIndex];if(!q)return;
    let scores={...(s.scores||{})};
    let correct=false;
    if(chosenAnswer!==null){const chosen=q.options[chosenAnswer];correct=String(chosen)===String(q.answer)||String(chosenAnswer)===String(q.answer);if(correct)scores[currentUser.uid]=(scores[currentUser.uid]||0)+1;}
    const nextIndex=Number(s.currentQuestionIndex||0)+1;
    const order=s.playerOrder||[];const other=order.find(uid=>uid!==currentUser.uid)||currentUser.uid;
    const finished=nextIndex>=qs.length;
    tx.update(ref,{scores,currentQuestionIndex:nextIndex,currentPlayerUid:finished?currentUser.uid:other,answered:false,turnEndsAt:Date.now()+30000,lastFeedback:finished?"Game complete!":(correct?"Correct! +1 point":feedback||"Turn skipped."),status:finished?"finished":"playing"});
  });
}
$("submitAnswer").addEventListener("click",async()=>{
  if(selectedOption===null||gameActionBusy||!currentGame)return;
  gameActionBusy=true;$("submitAnswer").disabled=true;
  try{await runSafeTurn(doc(db,"rooms",roomCode,"gameState","current"),"Answer submitted.",selectedOption);selectedOption=null;}
  catch(e){notice(`Answer could not be submitted: ${e.message}`,"error");}
  finally{gameActionBusy=false;}
});
$("skipQuestion").addEventListener("click",()=>advanceTurn("Question skipped."));
$("nextQuestion").addEventListener("click",()=>{selectedOption=null;renderGame();});
$("chatForm").addEventListener("submit",async e=>{
  e.preventDefault();const text=$("chatInput").value.trim();if(!text||!roomCode||!currentUser)return;
  try{await addDoc(collection(db,"rooms",roomCode,"messages"),{uid:currentUser.uid,displayName:profile.displayName,text:text.slice(0,500),createdAt:serverTimestamp()});$("chatInput").value="";}
  catch(err){notice(`Message not sent: ${err.message}`,"error");}
});
$("roomCode").addEventListener("input",e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);});
renderMyAvatar();drawAvatarChoices();
onAuthStateChanged(auth,async user=>{
  currentUser=user;
  if(!user){try{await signInGuest();}catch(e){notice(`Firebase sign-in failed: ${e.message}`,"error");}return;}
  try{const saved=await loadProfile(user.uid);if(saved){profile=saved;$("displayName").value=saved.displayName;renderMyAvatar();drawAvatarChoices();$("pictureStatus").textContent="Your saved profile is ready.";}}
  catch(e){notice(`Profile could not load: ${e.message}`,"error");}
});
