import {
  auth,
  db
} from "./firebase.js";

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

function showMessage(message, error = false) {
  let box = $("adminMessage");

  if (!box) {
    box = document.createElement("div");
    box.id = "adminMessage";
    box.style.cssText =
      "padding:12px;margin:12px 0;border-radius:8px;overflow-wrap:anywhere;";
    document.body.prepend(box);
  }

  box.textContent = message;
  box.style.background = error ? "#ffe5e5" : "#e2ffe8";
  box.style.color = "#222";
}

function showLogin() {
  let button = $("googleSignIn");

  if (!button) {
    button = [...document.querySelectorAll("button")]
      .find(b => /google|sign.?in|login/i.test(b.textContent));

  }

  if (button) {
    button.hidden = false;
    button.disabled = false;
  }
}

async function adminLogin() {
  try {
    showMessage("Opening Google sign-in...");

    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    if (!user.email || !user.emailVerified) {
      await signOut(auth);
      showMessage(
        "Please use a verified Google account.",
        true
      );
      return;
    }

    currentAdmin = user;

    showMessage(
      "Google sign-in successful: " + user.email
    );

    await loadQuestions();

  } catch (error) {
    console.error("Admin sign-in error:", error);

    showMessage(
      "Sign-in failed.\nError code: " +
      (error.code || "unknown") +
      "\nDetails: " +
      (error.message || "No additional details"),
      true
    );
  }
}

async function loadQuestions() {
  if (!currentAdmin) return;

  try {
    const snapshot = await getDocs(collection(db, "questions"));

    showMessage(
      "Signed in as " + currentAdmin.email +
      ". Questions found: " + snapshot.size
    );

    const list = $("questionList");

    if (list) {
      list.replaceChildren();

      snapshot.forEach(item => {
        const data = item.data();
        const row = document.createElement("div");

        const title = document.createElement("span");
        title.textContent =
          (data.category || "Uncategorized") +
          ": " + (data.text || "Untitled question");

        row.appendChild(title);
        row.appendChild(document.createElement("br"));

        const remove = document.createElement("button");
        remove.textContent = "Delete";

        remove.addEventListener("click", async () => {
          if (!confirm("Delete this question?")) return;

          try {
            await deleteDoc(doc(db, "questions", item.id));
            showMessage("Question deleted.");
            await loadQuestions();
          } catch (error) {
            showMessage(
              "Delete failed: " + error.message,
              true
            );
          }
        });

        row.appendChild(remove);
        list.appendChild(row);
      });
    }
  } catch (error) {
    console.error("Question loading error:", error);

    showMessage(
      "Could not load questions: " +
      (error.code || "") + " " + error.message,
      true
    );
  }
}

async function addQuestion(event) {
  event.preventDefault();

  if (!currentAdmin) {
    showMessage("Sign in with your admin Google account first.", true);
    return;
  }

  const text = $("questionText")?.value.trim();
  const category = $("questionCategory")?.value.trim();
  const options = [
    $("optionA")?.value.trim(),
    $("optionB")?.value.trim(),
    $("optionC")?.value.trim(),
    $("optionD")?.value.trim()
  ].filter(Boolean);

  const answer = $("correctAnswer")?.value;

  if (!text || !category || options.length < 2 || !answer) {
    showMessage(
      "Complete the question, category, at least two options, and correct answer.",
      true
    );
    return;
  }

  try {
    await addDoc(collection(db, "questions"), {
      text,
      category,
      options,
      correctAnswer: answer,
      createdBy: currentAdmin.uid,
      createdAt: serverTimestamp(),
      active: true
    });

    showMessage("Question added successfully.");

    $("questionForm")?.reset();

    await loadQuestions();

  } catch (error) {
    console.error("Add question error:", error);

    showMessage(
      "Could not add question: " +
      (error.code || "") + " " + error.message,
      true
    );
  }
}

const loginButton = $("googleSignIn");

if (loginButton) {
  loginButton.addEventListener("click", adminLogin);
} else {
  showMessage(
    "The Google sign-in button was not found. Check admin.html.",
    true
  );
}

const form = $("questionForm");

if (form) {
  form.addEventListener("submit", addQuestion);
}

onAuthStateChanged(auth, user => {
  if (user && user.providerData.some(
    item => item.providerId === "google.com"
  )) {
    currentAdmin = user;
    loadQuestions();
  } else {
    currentAdmin = null;
    showLogin();
  }
});
