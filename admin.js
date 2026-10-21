import { auth, db } from "./firebase.js";

import {
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
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
provider.setCustomParameters({ prompt: "select_account" });

let currentAdmin = null;
let busy = false;

function message(text, error = false) {
  const box = $("adminMessage");
  if (!box) return;

  box.textContent = text;
  box.style.background = error ? "#ffe5e5" : "#e2ffe8";
  box.style.color = "#222";
}

function showAdmin(show) {
  $("questionSection")?.classList.toggle("hidden", !show);
  $("questionsSection")?.classList.toggle("hidden", !show);
  $("googleSignIn")?.classList.toggle("hidden", show);
  $("signOutButton")?.classList.toggle("hidden", !show);
}

async function login() {
  if (busy) return;

  busy = true;
  const button = $("googleSignIn");
  if (button) button.disabled = true;

  message("Opening Google sign-in...");

  try {
    await signInWithRedirect(auth, provider);
  } catch (error) {
    console.error("Google redirect error:", error);
    message(
      "Sign-in failed: " + (error.code || "") +
      "\n" + (error.message || "Unknown error"),
      true
    );

    busy = false;
    if (button) button.disabled = false;
  }
}

async function logout() {
  try {
    await signOut(auth);
    currentAdmin = null;
    showAdmin(false);
    message("Signed out successfully.");
  } catch (error) {
    message("Sign-out failed: " + error.message, true);
  }
}

async function loadQuestions() {
  if (!currentAdmin) return;

  const list = $("questionList");
  if (!list) return;

  list.textContent = "Loading questions...";

  try {
    const snapshot = await getDocs(collection(db, "questions"));
    list.replaceChildren();

    if (snapshot.empty) {
      list.textContent = "No questions added yet.";
      message("Signed in. No questions found.");
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
        if (!currentAdmin || !confirm("Delete this question?")) return;

        try {
          await deleteDoc(doc(db, "questions", item.id));
          message("Question deleted.");
          await loadQuestions();
        } catch (error) {
          message(
            "Delete failed: " + (error.code || "") +
            "\n" + error.message,
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
      "Loading failed: " + (error.code || "") +
      "\n" + error.message,
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

  const fields = [
    $("optionA").value.trim(),
    $("optionB").value.trim(),
    $("optionC").value.trim(),
    $("optionD").value.trim()
  ];

  const options = fields.filter(Boolean);
  const answerIndex = Number($("correctAnswer").value);

  if (!text || !category || options.length < 2) {
    message("Enter a question, category and at least two options.", true);
    return;
  }

  if (
    $("correctAnswer").value === "" ||
    !Number.isInteger(answerIndex) ||
    answerIndex < 0 ||
    answerIndex >= options.length
  ) {
    message("Select a valid correct answer.", true);
    return;
  }

  const saveButton = $("addQuestionButton");
  if (saveButton) saveButton.disabled = true;

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
    console.error("Question save error:", error);
    message(
      "Save failed: " + (error.code || "") +
      "\n" + error.message,
      true
    );
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}

$("googleSignIn")?.addEventListener("click", login);
$("signOutButton")?.addEventListener("click", logout);
$("questionForm")?.addEventListener("submit", saveQuestion);
$("refreshQuestions")?.addEventListener("click", loadQuestions);

// Process the result after Google redirects back to this page.
try {
  const result = await getRedirectResult(auth);

  if (result?.user) {
    currentAdmin = result.user;

    if (!currentAdmin.emailVerified) {
      await signOut(auth);
      currentAdmin = null;
      showAdmin(false);
      message("Use a verified Google account.", true);
    }
  }
} catch (error) {
  console.error("Redirect result error:", error);
  message(
    "Google sign-in failed: " + (error.code || "") +
    "\n" + error.message,
    true
  );
}

onAuthStateChanged(auth, user => {
  const isGoogleUser = user &&
    user.providerData.some(p => p.providerId === "google.com");

  currentAdmin = isGoogleUser ? user : null;
  showAdmin(Boolean(currentAdmin));

  if (currentAdmin) {
    message("Signed in as " + currentAdmin.email);
    loadQuestions();
  } else {
    message("Please sign in with your admin Google account.");
  }
});
