import {
  auth, db, onAuthStateChanged, collection, doc, getDocs, addDoc, setDoc,
  updateDoc, deleteDoc, query, orderBy, serverTimestamp, GoogleAuthProvider,
  signInWithPopup, signOut
} from "./firebase.js";

const $=id=>document.getElementById(id);
let questions=[], editingId="";
function msg(text,type=""){const el=$("adminNotice");el.textContent=text;el.className="notice show"+(type?" "+type:"");}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
$("adminLogin").addEventListener("click",async()=>{
  try{const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:"select_account"});await signInWithPopup(auth,provider);}
  catch(e){msg(`Google sign-in failed: ${e.message}`,"error");}
});
$("adminLogout").addEventListener("click",async()=>{try{await signOut(auth);msg("Signed out.");}catch(e){msg(e.message,"error");}});
onAuthStateChanged(auth,user=>{
  const admin=user && !user.isAnonymous && user.email;
  $("loginPanel").classList.toggle("hidden",!!admin);$("managerPanel").classList.toggle("hidden",!admin);
  if(admin)loadQuestions();
});
async function loadQuestions(){
  try{
    const snap=await getDocs(query(collection(db,"questions"),orderBy("category")));
    questions=snap.docs.map(d=>({id:d.id,...d.data()}));renderList();renderCategories();
    msg(`Signed in as ${auth.currentUser.email}. If loading is denied, add this email to firestore.rules and publish the rules.`, "success");
  }catch(e){msg(`Could not load questions: ${e.message}. Check that this Google email is authorized in firestore.rules and publish the rules.`,"error");}
}
function renderCategories(){
  const current=$("filterCategory").value;const cats=[...new Set(questions.map(q=>q.category||"General"))].sort();
  $("filterCategory").innerHTML='<option value="">All categories</option>'+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
  if(cats.includes(current))$("filterCategory").value=current;
}
function renderList(){
  const filter=$("filterCategory").value;
  const list=questions.filter(q=>!filter||q.category===filter);
  $("questionCount").textContent=`${questions.length} questions · ${questions.filter(q=>q.active!==false).length} active`;
  $("questionList").innerHTML=list.map(q=>{
    const opts=Array.isArray(q.options)?q.options:[];
    const answerIndex=opts.findIndex(o=>String(o)===String(q.answer));
    return `<article class="question-item"><small>${esc(q.category||"General")} · ${q.active===false?"Inactive":"Active"}</small><p><strong>${esc(q.text)}</strong></p><p>${opts.map((o,i)=>`${"ABCD"[i]||i+1}. ${esc(o)}`).join("<br>")}</p><p><strong>Answer:</strong> ${"ABCD"[answerIndex]||esc(q.answer)}</p><div class="actions"><button class="secondary" data-edit="${q.id}">Edit</button><button class="delete" data-delete="${q.id}">Delete</button></div></article>`;
  }).join("")||"<p>No questions found. Add one using the form above.</p>";
  $("questionList").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>editQuestion(b.dataset.edit)));
  $("questionList").querySelectorAll("[data-delete]").forEach(b=>b.addEventListener("click",()=>removeQuestion(b.dataset.delete)));
}
$("filterCategory").addEventListener("change",renderList);
function clearForm(){editingId="";$("questionForm").reset();$("editId").value="";$("qActive").checked=true;$("saveQuestion").textContent="Save question";}
$("clearForm").addEventListener("click",clearForm);
function editQuestion(id){
  const q=questions.find(x=>x.id===id);if(!q)return;editingId=id;$("editId").value=id;$("qText").value=q.text||"";$("qCategory").value=q.category||"General";
  const opts=Array.isArray(q.options)?q.options:[];for(let i=0;i<4;i++)$(`option${i}`).value=opts[i]||"";
  let index=opts.findIndex(o=>String(o)===String(q.answer));if(index<0&&Number.isInteger(q.answer))index=q.answer;
  $("correctAnswer").value=String(Math.max(0,Math.min(3,index)));$("qActive").checked=q.active!==false;$("saveQuestion").textContent="Update question";window.scrollTo({top:0,behavior:"smooth"});
}
$("questionForm").addEventListener("submit",async e=>{
  e.preventDefault();const text=$("qText").value.trim(),category=$("qCategory").value.trim();
  const options=[0,1,2,3].map(i=>$(`option${i}`).value.trim()).filter(Boolean);
  const answerIndex=Number($("correctAnswer").value);
  if(options.length<2){msg("Enter at least two answer options.","error");return;}
  if(answerIndex>=options.length){msg("The selected correct answer has no option. Fill that option or choose another answer.","error");return;}
  const payload={text,category,options,answer:options[answerIndex],active:$("qActive").checked,updatedAt:serverTimestamp()};
  try{
    $("saveQuestion").disabled=true;
    if(editingId)await updateDoc(doc(db,"questions",editingId),payload);
    else await addDoc(collection(db,"questions"),{...payload,createdAt:serverTimestamp()});
    msg(editingId?"Question updated.":"Question added.","success");clearForm();await loadQuestions();
  }catch(err){msg(`Could not save question: ${err.message}`,"error");}
  finally{$("saveQuestion").disabled=false;}
});
async function removeQuestion(id){
  const q=questions.find(x=>x.id===id);if(!q||!confirm(`Delete this question?\n\n${q.text}`))return;
  try{await deleteDoc(doc(db,"questions",id));questions=questions.filter(x=>x.id!==id);renderList();renderCategories();msg("Question deleted.","success");}
  catch(e){msg(`Could not delete question: ${e.message}`,"error");}
}
