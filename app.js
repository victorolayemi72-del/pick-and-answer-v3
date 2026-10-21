import {
  auth, db, signInGuest, onAuthStateChanged,
  collection, doc, getDoc, getDocs, addDoc,
  updateDoc, setDoc, query, orderBy, limit,
  onSnapshot, serverTimestamp,
  saveProfile, loadProfile, createRoom, joinRoom, startGame
} from "./firebase.js";

const $ = id => document.getElementById(id);

const AVATARS = [
  "🐼","🐻","🐱","🦊","🐸","🐨","🐰","🐯",
  "🐶","🦁","🐵","🐧","🦄","🐙","🐹","🐷",
  "🐮","🐣","🦋","🐺","🐻‍❄️","🐢","🦉"
];

let uid = null;
let profile = { displayName:"", avatar:"🐼", photoURL:"" };
let roomCode = null;
let unsubscribers = [];
let game = null;
let question = null;
let chosen = null;
let submitted = false;
let timer = null;
let renderedQuestionKey = "";
let deadline = 0;
let roomCreator = false;
let busy = false;

function notice(message, bad = true) {
  const box = $("notice");
  box.textContent = message;
  box.classList.add("show");
  box.style.background = bad ? "#fff0d8" : "#e8faef";
  box.style.color = bad ? "#6d4313" : "#185c36";
}

function clearNotice() {
  $("notice").classList.remove("show");
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;",
    '"':"&quot;", "'":"&#39;"
  })[c]);
}

function avatarHTML(player, large = false) {
  const cls = large ? "avatar large" : "avatar";
  if (player?.photoURL) {
    return `<div class="${cls}"><img src="${escapeHTML(player.photoURL)}" alt="Profile picture"></div>`;
  }
  return `<div class="${cls}">${escapeHTML(player?.avatar || "🐼")}</div>`;
}

function renderMyAvatar() {
  $("myAvatar").innerHTML = profile.photoURL
    ? `<img src="${escapeHTML(profile.photoURL)}" alt="Your profile picture">`
    : escapeHTML(profile.avatar || "🐼");

  $("pictureStatus").textContent = profile.photoURL
    ? "Your picture is selected. Save your profile to keep it."
    : "You're using an avatar. Save your profile to keep it.";
}

function drawAvatarChoices() {
  $("avatarChoices").innerHTML = AVATARS.map(avatar => `
    <button type="button"
      class="avatar-choice ${
        !profile.photoURL && profile.avatar === avatar ? "selected" : ""
      }"
      data-avatar="${avatar}"
      aria-label="Choose avatar ${avatar}">${avatar}</button>
  `).join("");

  $("avatarChoices").querySelectorAll("[data-avatar]").forEach(button => {
    button.addEventListener("click", () => {
      profile.avatar = button.dataset.avatar;
      profile.photoURL = "";
      $("profilePicture").value = "";
      renderMyAvatar();
      drawAvatarChoices();
      notice("Avatar selected. Tap Save profile to save it.", false);
    });
  });
}

async function compressImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Please select an image.");
  }

  if (file.size > 12 * 1024 * 1024) {
    throw new Error("Choose an image smaller than 12 MB.");
  }

  const objectURL = URL.createObjectURL(file);

  try {
    const image = new Image();

    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Could not open that picture."));
      image.src = objectURL;
    });

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;

    const side = Math.min(image.width, image.height);
    canvas.getContext("2d").drawImage(
      image,
      (image.width - side) / 2,
      (image.height - side) / 2,
      side, side, 0, 0, 256, 256
    );

    let quality = 0.75;
    let result = canvas.toDataURL("image/jpeg", quality);

    while (result.length > 180000 && quality > 0.35) {
      quality -= 0.1;
      result = canvas.toDataURL("image/jpeg", quality);
    }

    if (result.length > 180000) {
      throw new Error("This picture is too large. Please choose another.");
    }

    return result;
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}

$("profilePicture").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    profile.photoURL = await compressImage(file);
    renderMyAvatar();
    drawAvatarChoices();
    notice("Picture selected. Tap Save profile to save it.", false);
  } catch (error) {
    event.target.value = "";
    notice(error.message);
  }
});

$("useAvatar").addEventListener("click", () => {
  profile.photoURL = "";
  $("profilePicture").value = "";
  renderMyAvatar();
  drawAvatarChoices();
  notice("Choose an avatar below, then save your profile.", false);
});

async function saveCurrentProfile() {
  if (!uid) throw new Error("Waiting for Firebase sign-in. Try again shortly.");

  const name = $("displayName").value.trim();
  if (name.length < 2) throw new Error("Enter a name with at least 2 characters.");

  profile.displayName = name.slice(0, 24);

  await saveProfile(uid, profile);

  if (roomCode) {
    await setDoc(doc(db, "rooms", roomCode, "players", uid), {
      uid,
      displayName: profile.displayName,
      photoURL: profile.photoURL || "",
      avatar: profile.avatar || "🐼"
    }, { merge: true });
  }

  localStorage.setItem("pickAnswerProfile", JSON.stringify(profile));
  renderMyAvatar();
  drawAvatarChoices();
  notice("Profile saved successfully! ❤️", false);
}

$("saveProfile").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  $("saveProfile").disabled = true;

  try {
    await saveCurrentProfile();
  } catch (error) {
    console.error("Profile save failed:", error);
    notice("Profile couldn't be saved: " + error.message);
  } finally {
    busy = false;
    $("saveProfile").disabled = false;
  }
});

function cleanRoom() {
  unsubscribers.forEach(unsubscribe => unsubscribe());
  unsubscribers = [];

  if (timer) clearInterval(timer);
  timer = null;

  roomCode = null;
  game = null;
  question = null;
  chosen = null;
  submitted = false;
  renderedQuestionKey = "";

  $("roomLabel").textContent = "";
  $("players").innerHTML = "";
  $("gameCard").classList.add("hidden");
  $("chatCard").classList.add("hidden");
  $("startGame").classList.add("hidden");
  $("returnLobby").classList.add("hidden");
  $("lobbyCard").classList.remove("hidden");
}

function watchRoom(code) {
  cleanRoom();
  roomCode = code;
  $("roomLabel").textContent = "ROOM CODE: " + code;
  $("returnLobby").classList.remove("hidden");

  const roomRef = doc(db, "rooms", code);

  unsubscribers.push(onSnapshot(
    collection(db, "rooms", code, "players"),
    async snapshot => {
      const players = snapshot.docs.map(d => d.data());

      $("players").innerHTML = players.map(player => `
        <div class="player">
          ${avatarHTML(player)}
          <div>
            <strong>${escapeHTML(player.displayName || "Player")}</strong>
            <div class="muted">${player.uid === uid ? "You" : "Your opponent"}</div>
          </div>
        </div>
      `).join("");

      try {
        const room = await getDoc(roomRef);
        roomCreator = room.exists() && room.data().createdBy === uid;

        $("startGame").classList.toggle(
          "hidden",
          !(players.length === 2 && roomCreator && room.data().status === "waiting")
        );
      } catch (error) {
        console.error(error);
      }
    },
    error => notice("Player list failed: " + error.message)
  ));

  unsubscribers.push(onSnapshot(
    doc(db, "rooms", code, "gameStatetionIds?.length ||
    game.questions?.length || 0;

  renderScores();

  if (game.status === "finished" || index >= total) {
    if (tick) clearInterval(tick);

    $("questionText").textContent = "Game complete! ❤️";
    $("category").textContent = "Final results";
    $("options").innerHTML = "";
    $("submitAnswer").classList.add("hidden");
    $("skipQuestion").classList.add("hidden");
    $("nextQuestion").classList.add("hidden");
    $("progress").textContent = "Finished";
    $("timer").textContent = "—";

    renderScores();
    return;
  }

  $("progress").textContent =
    `Question ${index + 1} of ${total}`;

  if (game.status !== "playing") return;

  const key = `${index}:${game.questionIds?.[index] || ""}`;

  if (renderedQuestionKey !== key) {
    renderedQuestionKey = key;
    question = await getCurrentQuestion();

    chosen = null;
    submitted = false;

    $("answerFeedback").textContent = "";
    $("submitAnswer").classList.remove("hidden");
    $("skipQuestion").classList.remove("hidden");
    $("nextQuestion").classList.add("hidden");

    if (!question) {
      $("questionText").textContent =
        "Unable to load this question. Please check Firestore.";
      $("category").textContent = "Question error";
      $("options").innerHTML = "";
      return;
    }

    $("questionText").textContent = question.text;
    $("category").textContent = question.category;

    if (question.options.length > 0) {
      $("options").innerHTML = question.options.map((option, i) => {
        const label = typeof option === "object"
          ? option.text || option.label || ""
          : String(option);

        return `
          <button class="option" data-index="${i}">
            ${escapeHTML(label)}
          </button>
        `;
      }).join("");

      $("options").querySelectorAll("button").forEach(button => {
        button.onclick = () => {
          if (submitted || game.currentPlayerUid !== uid) return;

          chosen = Number(button.dataset.index);

          $("options").querySelectorAll("button").forEach(item => {
            item.classList.toggle("selected", item === button);
          });
        };
      });
    } else {
      // Existing questions are open-ended.
      $("options").innerHTML = `
        <p class="muted">
          Take turns answering this question aloud or in the chat.
          Tap "I've Answered" when you're ready to continue.
        </p>
      `;
    }
  }

  const isTurn = game.currentPlayerUid === uid;

  $("submitAnswer").textContent = question?.options?.length
    ? "Submit answer"
    : "I've Answered";

  $("submitAnswer").disabled = !isTurn || submitted;
  $("skipQuestion").disabled = !isTurn || submitted;

  $("answerFeedback").textContent = isTurn
    ? "It'sextContent = "—";
    renderScores();
    return;
  }

  $("progress").textContent = `Question ${index + 1} of ${total}`;

  renderScores();

  if (game.status !== "playing") return;

  if (!question || question.id !== game.questionIds[index]) {
    question = await getCurrentQuestion();
    chosen = null;
    submitted = false;

    $("answerFeedback").textContent = "";
    $("submitAnswer").classList.remove("hidden");
    $("skipQuestion").classList.remove("hidden");
    $("nextQuestion").classList.add("hidden");

    if (!question) {
      $("questionText").textContent = "Question not found. Check the question document format.";
      $("options").innerHTML = "";
      return;
    }

    $("questionText").textContent = question.text;
    $("category").textContent = question.category;

    $("options").innerHTML = question.options.map((option, index) => `
      <button class="option" data-index="${index}">
        ${escapeHTML(
          typeof option === "object"
            ? option.text || option.label || JSON.stringify(option)
            : String(option)
        )}
      </button>
    `).join("");

    $("options").querySelectorAll("button").forEach(button => {
      button.onclick = () => {
        if (submitted) return;

        chosen = Number(button.dataset.index);

        $("options").querySelectorAll("button").forEach(item => {
          item.classList.toggle("selected", item === button);
        });
      };
    });
  }

  const isTurn = game.currentPlayerUid === uid;

  $("submitAnswer").disabled = !isTurn || submitted;
  $("skipQuestion").disabled = !isTurn || submitted;

  $("answerFeedback").textContent = isTurn
    ? "Your turn — choose an answer."
    : "Waiting for your opponent to answer…";

  startTimer();
}

function startTimer() {
  if (tick) clearInterval(tick);

  deadline = Number(game?.turnEndsAt) || Date.now() + 30000;

  tick = setInterval(async () => {
    const remaining = Math.max(
      0,
      Math.ceil((deadline - Date.now()) / 1000)
    );

    $("timer").textContent = remaining;
    $("timerBar").style.width = (remaining / 30 * 100) + "%";

    if (remaining === 0) {
      clearInterval(tick);

      if (game?.currentPlayerUid === uid && !submitted) {
        await advanceTurn(true);
      }
    }
  }, 250);
}

function renderScores() {
  const players = game?.playerOrder || [];

  $("scores").innerHTML = players.map(id => `
    <div class="score">
      ${id === uid ? "You" : "Opponent"}:
      <strong>${Number(game?.scores?.[id] || 0)}</strong>
    </div>
  `).join("");
}

async function advanceTurn(skipped = false, correct = false) {
  if (!game || game.currentPlayerUid !== uid) return;

  const players = game.playerOrder || [];
  const nextIndex = (game.currentQuestionIndex || 0) + 1;

  const myIndex = Math.max(0, players.indexOf(uid));
  const nextUid = players[(myIndex + 1) % players.length];

  const scores = { ...(game.scores || {}) };

  if (correct) {
    scores[uid] = (scores[uid] || 0) + 1;
  }

  const finished = nextIndex >= (game.questionIds || []).length;

  await updateDoc(
    doc(db, "rooms", roomCode, "gameState", "current"),
    {
      currentQuestionIndex: nextIndex,
      currentPlayerUid: nextUid,
      scores,
      status: finished ? "finished" : "playing",
      turnEndsAt: Date.now() + 30000,
      lastAction: skipped ? "skipped" : "answered",
      lastActionBy: uid
    }
  );

  question = null;
  chosen = null;
  submitted = false;
}

$("saveProfile").onclick = async () => {
  try {
    clearNotice();
    $("saveProfile").disabled = true;
    $("saveProfile").textContent = "Saving…";

    await saveCurrentProfile();
  } catch (error) {
    notice(error.message || "Could not save your profile.");
  } finally {
    $("saveProfile").disabled = false;
    $("saveProfile").textContent = "Save profile";
  }
};

$("createRoom").onclick = async () => {
  try {
    clearNotice();

    if (!profile.displayName) {
      await saveCurrentProfile();
    }

    const code = await createRoom(profile);

    watchRoom(code);

    notice("Room created. Share the code with your opponent.", false);
  } catch (error) {
    notice(error.message || "Could not create room.");
  }
};

$("joinRoom").onclick = async () => {
  try {
    clearNotice();

    if (!profile.displayName) {
      await saveCurrentProfile();
    }

    const code = await joinRoom($("roomCode").value, profile);

    watchRoom(code);

    notice("Joined room successfully.", false);
  } catch (error) {
    notice(error.message || "Could not join room.");
  }
};

$("startGame").onclick = async () => {
  try {
    await startGame(roomCode);
    notice("Game started!", false);
  } catch (error) {
    notice(error.message || "Could not start game.");
  }
};

$("submitAnswer").onclick = async () => {
  if (chosen === null) {
    notice("Choose an answer first.");
    return;
  }

  if (!game || game.currentPlayerUid !== uid || submitted) return;

  submitted = true;
  $("submitAnswer").disabled = true;

  const correct =
    String(question.answer) === String(chosen) ||
    String(question.answer) === String(question.options[chosen]);

  $("answerFeedback").textContent = correct
    ? "Correct! +1 point"
    : "Answer submitted.";

  try {
    await advanceTurn(false, correct);
  } catch (error) {
    submitted = false;
    notice("Could not submit answer: " + error.message);
  }
};

$("skipQuestion").onclick = async () => {
  try {
    if (game?.currentPlayerUid !== uid) return;

    submitted = true;
    await advanceTurn(true, false);
  } catch (error) {
    notice(error.message || "Could not skip.");
  }
};

$("nextQuestion").onclick = () => {};

$("returnLobby").onclick = () => {
  cleanRoom();

  notice(
    "You left the room view. The other player's room remains in Firebase.",
    false
  );
};

$("chatForm").onsubmit = async event => {
  event.preventDefault();

  const text = $("chatInput").value.trim();

  if (!text || !roomCode) return;

  try {
    await addDoc(
      collection(db, "rooms", roomCode, "messages"),
      {
        uid,
        displayName: profile.displayName,
        text: text.slice(0, 500),
        createdAt: serverTimestamp()
      }
    );

    $("chatInput").value = "";
  } catch (error) {
    notice("Message could not be sent. Check Firestore rules.");
  }
};

onAuthStateChanged(auth, async user => {
  if (!user) return;

  uid = user.uid;

  try {
    const stored = JSON.parse(
      localStorage.getItem("pickAnswerProfile") || "{}"
    );

    const saved = await loadProfile(uid);

    profile = {
      displayName: saved?.displayName || stored.displayName || "",
      avatar: saved?.avatar || stored.avatar || "🐼",
      photoURL: saved?.photoURL || stored.photoURL || ""
    };

    $("displayName").value = profile.displayName;

    renderMyAvatar();
    drawAvatarChoices();
  } catch (error) {
    renderMyAvatar();
    drawAvatarChoices();
    notice("Could not load your saved profile: " + error.message);
  }
});

signInGuest().catch(error => {
  notice("Firebase sign-in failed: " + error.message);
});
