import { auth, db } from "./firebase.js";

import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = id => document.getElementById(id);

const provider = new GoogleAuthProvider();

provider.setCustomParameters({
  prompt: "select_account"
});

let currentAdmin = null;
let busy = false;

function message(text, error = false) {
  const box = $("adminMessage");
  box.textContent = text;
  box.style.background = error ? "#ffe5e5" : "#e2ffe8";
  box.style.color = "#222";
}

function showAdmin(show) {
  $("questionSection").classList.toggle("hidden", !show);
  $("questionsSection").classList.toggle("hidden", !show);
  $("googleSignIn").classList.toggle("hidden", show);
  $("signOutButton").classList.toggle("hidden", !show);
}

async function login() {
  if (busy) return;

  busy = true;
  $("googleSignIn").disabled = true;
  message("Opening Google sign-in...");

  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    if (!user.email || !user.emailVerified) {
      await signOut(auth);
      throw new Error("Use a verified Google account.");
    }

    currentAdmin = user;
    showAdmin(true);

    message("Signed in as " + user.email);

    await loadQuestions();

  } catch (error) {
    console.error("Google sign-in error:", error);

    message(
      "Sign-in failed: " +
      (error.code || "") + "\n" +
      (error.message || "Unknown error"),
      true
    );
  } finally {
    busy = false;
    $("googleSignIn").disabled = false;
  }
}

async function logout() {
  try {
    await signOut(auth);
    currentAdmin = null;
    showAdmin(false);
    message("You have signed out.");
  } catch (error) {
    message("Sign-out failed: " + error.message, true);
  }
}

async function loadQuestions() {
  if (!currentAdmin) return;

  const list = $("questionList");
  list.textContent = "Loading questions...";

  try {
    const snapshot = await getDocs(collection(db, "questions"));

    list.replaceChildren();

    if (snapshot.empty) {
      list.textContent =
        "No questions have been added yet. Add your first question above.";
      return;
    }

    snapshot.forEach(item => {
      const data = item.data();

      const card = document.createElement("div");
      card.className = "question";

      const title = document.createElement("strong");
      title.textContent = data.text || "Untitled question";

      const category = document.createElement("p");
      category.textContent = "Category: " + (data.category || "Uncategorized");

      const options = document.createElement("p");
      options.textContent = "Options: " +
        (Array.isArray(data.options) ? data.options.join(" | ") : "None");

      const remove = document.createElement("button");
      remove.className = "danger";
      remove.textContent = "Delete question";

      remove.addEventListener("click", async () => {
        if (!currentAdmin) return;
        if (!confirm("Delete this question?")) return;

        try {
          await deleteDoc(doc(db, "questions", item.id));
          message("Question deleted.");
          await loadQuestions();
        } catch (error) {
          message(
            "Delete failed: " +
            (error.code || "") + " " + error.message,
            true
          );
        }
      });

      card.append(title, category, options, remove);
      list.appendChild(card);
    });

    message("Loaded " + snapshot.size + " question(s).");

  } catch (error) {
    console.error("Question loading error:", error);

    list.textContent = "Could not load questions.";

    message(
      "Loading failed: " +
      (error.code || "") + "\n" + error.message,
      true
    );
  }
}

async function saveQuestion(event) {
  event.preventDefault();

  if (!currentAdmin) {
    message("Sign in first.", true);
    return;
  }

  const text = $("questionText").value.trim();
  const category = $("questionCategory").value;

  const optionFields = [
    $("optionA").value.trim(),
    $("optionB").value.trim(),
    $("optionC").value.trim(),
    $("optionD").value.trim()
  ];

  const options = optionFields.filter(Boolean);
  const answerIndex = Number($("correctAnswer").value);

  if (!text || !category || options.length < 2) {
    message("Enter a question, category and at least two options.", true);
    return;
  }

  if (
    !Number.isInteger(answerIndex) ||
    answerIndex < 0 ||
    answerIndex >= options.length
  ) {
    message("Choose a correct answer that has been provided.", true);
    return;
  }

  $("addQuestionButton").disabled = true;

  try {
    await addDoc(collection(db, "questions"), {
      text,
      category,
      options,
      correctAnswer: answerIndex,
      active: true,
      createdBy: currentAdmin.uid,
      createdAt: serverTimestamp()
    });

    $("questionForm").reset();

    message("Question saved successfully.");

    await loadQuestions();

  } catch (error) {
    console.error("Saving question error:", error);

    message(
      "Could not save question: " +
      (error.code || "") + "\n" + error.message,
      true
    );
  } finally {
    $("addQuestionButton").disabled = false;
  }
}

$("googleSignIn").addEventListener("click", login);
$("signOutButton").addEventListener("click", logout);
$("questionForm").addEventListener("submit", saveQuestion);
$("refreshQuestions").addEventListener("click", loadQuestions);

onAuthStateChanged(auth, user => {
  if (user && user.providerData.some(
    providerInfo => providerInfo.providerId === "google.com"
  )) {
    currentAdmin = user;
    showAdmin(true);
    message("Signed in as " + user.email);
    loadQuestions();
  } else {
    currentAdmin = null;
    showAdmin(false);
    message("Please sign in with your admin Google account.");
  }
});
