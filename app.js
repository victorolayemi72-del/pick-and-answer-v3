import {
  auth, db, signInGuest, onAuthStateChanged,
  collection, doc, getDoc, getDocs, addDoc,
  updateDoc, setDoc, query, limit, onSnapshot,
  serverTimestamp, saveProfile, loadProfile,
  createRoom, joinRoom, startGame
} from "./firebase.js";

const $ = id => document.getElementById(id);

const AVATARS = [
  "🐼", "🐻", "🐱", "🦊", "🐸", "🐨", "🐰", "🐯",
  "🐶", "🦁", "🐵", "🐧", "🦄", "🐙", "🐹", "🐷",
  "🐮", "🐣", "🦋", "🐺", "🐻‍❄️", "🐢", "🦉"
];

let uid = null;
let profile = { displayName: "", avatar: "🐼", photoURL: "" };
let roomCode = null;
let roomCreator = false;
let game = null;
let question = null;
let chosen = null;
let submitted = false;
let busy = false;
let deadline = 0;
let timer = null;
let questionKey = "";
let unsubscribers = [];
let messagesUnsubscribe = null;
let playersUnsubscribe = null;
let gameUnsubscribe = null;
let roomUnsubscribe = null;
let advancing = false;

function showNotice(message, bad = true) {
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
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function avatarHTML(player, large = false) {
  const className = large ? "avatar large" : "avatar";

  if (player?.photoURL) {
    return `
      <div class="${className}">
        <img src="${escapeHTML(player.photoURL)}" alt="Profile picture">
      </div>`;
  }

  return `
    <div class="${className}">
      ${escapeHTML(player?.avatar || "🐼")}
    </div>`;
}

function renderMyAvatar() {
  const container = $("myAvatar");

  if (profile.photoURL) {
    container.innerHTML = `
      <img src="${escapeHTML(profile.photoURL)}"
           alt="Your profile picture">`;
  } else {
    container.textContent = profile.avatar || "🐼";
  }

  $("pictureStatus").textContent = profile.photoURL
    ? "Picture selected. Save your profile to keep it."
    : `Using avatar ${profile.avatar || "🐼"}. Save your profile to keep it.`;
}

function drawAvatarChoices() {
  $("avatarChoices").innerHTML = AVATARS.map(avatar => `
    <button
      type="button"
      class="avatar-choice ${
        !profile.photoURL && profile.avatar === avatar ? "selected" : ""
      }"
      data-avatar="${avatar}"
      aria-label="Choose avatar ${avatar}">
      ${avatar}
    </button>
  `).join("");

  $("avatarChoices").querySelectorAll("[data-avatar]").forEach(button => {
    button.addEventListener("click", () => {
      profile.avatar = button.dataset.avatar;
      profile.photoURL = "";
      $("profilePicture").value = "";

      renderMyAvatar();
      drawAvatarChoices();

      showNotice("Avatar selected! Tap Save profile.", false);
    });
  });
}

async function compressImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }

  if (file.size > 12 * 1024 * 1024) {
    throw new Error("Choose a picture smaller than 12 MB.");
  }

  const objectURL = URL.createObjectURL(file);

  try {
    const image = new Image();

    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Could not open this picture."));
      image.src = objectURL;
    });

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Your browser could not process this picture.");
    }

    const side = Math.min(image.width, image.height);

    context.drawImage(
      image,
      (image.width - side) / 2,
      (image.height - side) / 2,
      side,
      side,
      0,
      0,
      256,
      256
    );

    let quality = 0.75;
    let result = canvas.toDataURL("image/jpeg", quality);

    while (result.length > 180000 && quality > 0.35) {
      quality -= 0.1;
      result = canvas.toDataURL("image/jpeg", quality);
    }

    if (result.length > 180000) {
      throw new Error("Picture is too large. Choose another one.");
    }

    return result;
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}

// Picture upload
$("profilePicture").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    showNotice("Processing your picture…", false);

    profile.photoURL = await compressImage(file);

    renderMyAvatar();
    drawAvatarChoices();

    showNotice("Picture selected! Tap Save profile.", false);
  } catch (error) {
    event.target.value = "";
    showNotice(error.message || "Could not process the picture.");
  }
});

// Use an avatar
$("useAvatar").addEventListener("click", () => {
  profile.photoURL = "";
  $("profilePicture").value = "";

  renderMyAvatar();
  drawAvatarChoices();

  showNotice("Choose an avatar below, then save your profile.", false);
});

// Save profile
async function saveCurrentProfile() {
  if (!uid) {
    throw new Error("Waiting for Firebase sign-in. Try again shortly.");
  }

  const name = $("displayName").value.trim();

  if (name.length < 2) {
    throw new Error("Enter a name with at least 2 characters.");
  }

  profile.displayName = name.slice(0, 24);

  await saveProfile(uid, profile);

  if (roomCode) {
    await setDoc(doc(db, "rooms", roomCode, "players", uid), {
      uid,
      displayName: profile.displayName,
      avatar: profile.avatar,
      photoURL: profile.photoURL || ""
    }, { merge: true });
  }

  localStorage.setItem("pickAnswerProfile", JSON.stringify(profile));

  renderMyAvatar();
  drawAvatarChoices();

  showNotice("Profile saved successfully! ❤️", false);
}

$("saveProfile").addEventListener("click", async () => {
  if (busy) return;

  busy = true;
  $("saveProfile").disabled = true;

  try {
    await saveCurrentProfile();
  } catch (error) {
    console.error(error);
    showNotice("Profile could not be saved: " + error.message);
  } finally {
    busy = false;
    $("saveProfile").disabled = false;
  }
});

// Clean up subscriptions when leaving a room.
function stopRoomListeners() {
  unsubscribers.forEach(unsubscribe => {
    try {
      unsubscribe();
    } catch {}
  });

  unsubscribers = [];
  playersUnsubscribe = null;
  gameUnsubscribe = null;
  roomUnsubscribe = null;
  messagesUnsubscribe = null;

  if (timer) clearInterval(timer);
  timer = null;
}

function cleanRoom() {
  stopRoomListeners();

  roomCode = null;
  roomCreator = false;
  game = null;
  question = null;
  chosen = null;
  submitted = false;
  advancing = false;
  questionKey = "";

  $("roomLabel").textContent = "";
  $("players").innerHTML = "";
  $("chatMessages").innerHTML = "";

  $("gameCard").classList.add("hidden");
  $("chatCard").classList.add("hidden");
  $("startGame").classList.add("hidden");
  $("returnLobby").classList.add("hidden");
  $("lobbyCard").classList.remove("hidden");
}

function watchRoom(code) {
  cleanRoom();

  roomCode = code;

  $("roomCode").value = code;
  $("roomLabel").textContent = "ROOM CODE: " + code;
  $("returnLobby").classList.remove("hidden");

  $("lobbyCard").classList.remove("hidden");

  const roomRef = doc(db, "rooms", code);

  playersUnsubscribe = onSnapshot(
    collection(db, "rooms", code, "players"),
    snapshot => {
      const players = snapshot.docs.map(item => item.data());

      $("players").innerHTML = players.map(player => `
        <div class="player">
          ${avatarHTML(player)}
          <div>
            <strong>${escapeHTML(player.displayName || "Player")}</strong>
            <div class="muted">${player.uid === uid ? "You" : "Your opponent"}</div>
          </div>
        </div>
      `).join("");

      refreshRoomControls();
    },
    error => showNotice("Player list error: " + error.message)
  );

  unsubscribers.push(playersUnsubscribe);

  roomUnsubscribe = onSnapshot(
    roomRef,
    snapshot => {
      if (!snapshot.exists()) {
        showNotice("This room no longer exists.");
        return;
      }

      const room = snapshot.data();
      roomCreator = room.createdBy === uid;

      $("startGame").classList.toggle(
        "hidden",
        !(roomCreator && room.status === "waiting")
      );

      if (room.status === "playing" || room.status === "finished") {
        $("gameCard").classList.remove("hidden");
        $("chatCard").classList.remove("hidden");
      }
    },
    error => showNotice("Room update error: " + error.message)
  );

  unsubscribers.push(roomUnsubscribe);

  gameUnsubscribe = onSnapshot(
    doc(db, "rooms", code, "gameState", "current"),
    snapshot => {
      if (!snapshot.exists()) {
        game = null;
        return;
      }

      game = snapshot.data();

      $("gameCard").classList.remove("hidden");
      $("chatCard").classList.remove("hidden");

      renderGame().catch(error => {
        console.error("Game rendering error:", error);
        showNotice("Game display error: " + error.message);
      });
    },
    error => showNotice("Game state error: " + error.message)
  );

  unsubscribers.push(gameUnsubscribe);

  messagesUnsubscribe = onSnapshot(
    query(
      collection(db, "rooms", code, "messages"),
      orderBy("createdAt", "asc"),
      limit(100)
    ),
    snapshot => {
      $("chatMessages").innerHTML = snapshot.docs.map(item => {
        const message = item.data();
        const mine = message.uid === uid;

        return `
          <div class="message ${mine ? "mine" : ""}">
            <strong>${escapeHTML(message.displayName || "Player")}</strong>
            <div>${escapeHTML(message.text || "")}</div>
          </div>`;
      }).join("");

      $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
    },
    error => showNotice("Chat error: " + error.message)
  );

  unsubscribers.push(messagesUnsubscribe);

  refreshRoomControls();
}

async function refreshRoomControls() {
  if (!roomCode) return;

  try {
    const room = await getDoc(doc(db, "rooms", roomCode));

    if (!room.exists()) return;

    const players = await getDocs(
      collection(db, "rooms", roomCode, "players")
    );

    $("startGame").classList.toggle(
      "hidden",
      !(room.data().createdBy === uid &&
        room.data().status === "waiting" &&
        players.size === 2)
    );
  } catch (error) {
    console.error("Could not refresh room controls:", error);
  }
}

async function getCurrentQuestion() {
  if (!game) return null;

  const index = Number(game.currentQuestionIndex || 0);
  const embedded = game.questions?.[index];

  if (embedded?.text || embedded?.Text) {
    return normalizeQuestion(embedded);
  }

  const id = game.questionIds?.[index];
  if (!id) return null;

  const snapshot = await getDoc(doc(db, "questions", id));

  if (!snapshot.exists()) return null;

  return normalizeQuestion({
    ...snapshot.data(),
    id: snapshot.id
  });
}

function normalizeQuestion(data = {}) {
  const text = data.text ?? data.Text ?? data.question ?? data.Question ?? "";
  const rawOptions = data.options ?? data.Options ?? data.choices ?? [];

  let options = rawOptions;

  if (typeof options === "string") {
    try {
      options = JSON.parse(options);
    } catch {
      options = options.split("|").map(item => item.trim());
    }
  }

  if (!Array.isArray(options)) {
    options = Object.values(options || {});
  }

  return {
    id: data.id || "",
    text: String(text),
    category: String(data.category ?? data.Category ?? "General"),
    options,
    answer: data.answer ?? data.Answer ?? data.correctAnswer
  };
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

async function renderGame() {
  if (!game) return;

  const index = Number(game.currentQuestionIndex || 0);
  const total = game.questionIds?.length || game.questions?.length || 0;

  renderScores();

  if (game.status === "finished" || index >= total) {
    if (timer) clearInterval(timer);
    timer = null;

    $("questionText").textContent = "Game complete! ❤️";
    $("category").textContent = "Final results";
    $("options").innerHTML = "";
    $("submitAnswer").classList.add("hidden");
    $("skipQuestion").classList.add("hidden");
    $("nextQuestion").classList.add("hidden");
    $("progress").textContent = "Finished";
    $("timer").textContent = "—";
    $("answerFeedback").textContent = "Thanks for playing!";

    return;
  }

  $("progress").textContent = `Question ${index + 1} of ${total}`;

  if (game.status !== "playing") return;

  const key = `${index}:${game.questionIds?.[index] || ""}`;

  if (questionKey !== key) {
    questionKey = key;
    question = await getCurrentQuestion();

    chosen = null;
    submitted = false;

    $("answerFeedback").textContent = "";

    if (!question) {
      $("questionText").textContent = "Question not found.";
      $("category").textContent = "Question error";
      $("options").innerHTML = "";
      return;
    }

    $("questionText").textContent = question.text;
    $("category").textContent = question.category;

    if (question.options.length) {
      $("options").innerHTML = question.options.map((option, index) => {
        const label = typeof option === "object"
          ? option.text ?? option.label ?? String(option.value ?? "")
          : String(option);

        return `
          <button type="button" class="option" data-index="${index}">
            ${escapeHTML(label)}
          </button>`;
      }).join("");

      $("options").querySelectorAll("[data-index]").forEach(button => {
        button.addEventListener("click", () => {
          if (submitted || game?.currentPlayerUid !== uid) return;

          chosen = Number(button.dataset.index);

          $("options").querySelectorAll(".option").forEach(option => {
            option.classList.toggle("selected", option === button);
          });
        });
      });
    } else {
      $("options").innerHTML = `
        <p class="muted">
          Take turns answering aloud or in the chat, then tap "I've Answered".
        </p>`;
    }
  }

  const isTurn = game.currentPlayerUid === uid;

  $("submitAnswer").classList.remove("hidden");
  $("skipQuestion").classList.remove("hidden");
  $("nextQuestion").classList.add("hidden");

  $("submitAnswer").textContent = question?.options?.length
    ? "Submit answer"
    : "I've Answered";

  $("submitAnswer").disabled = !isTurn || submitted;
  $("skipQuestion").disabled = !isTurn || submitted;

  $("answerFeedback").textContent = submitted
    ? "Answer submitted."
    : isTurn
      ? "Your turn — choose an answer."
      : "Waiting for your opponent to answer…";

  startTimer();
}

function startTimer() {
  if (timer) clearInterval(timer);

  deadline = Number(game?.turnEndsAt) || Date.now() + 30000;

  const updateTimer = async () => {
    const remaining = Math.max(
      0,
      Math.ceil((deadline - Date.now()) / 1000)
    );

    $("timer").textContent = remaining;
    $("timerBar").style.width = `${remaining / 30 * 100}%`;

    if (remaining <= 0) {
      clearInterval(timer);
      timer = null;

      if (game?.currentPlayerUid === uid && !submitted && !advancing) {
        try {
          await advanceTurn(true, false);
        } catch (error) {
          showNotice("Could not advance the turn: " + error.message);
        }
      }
    }
  };

  updateTimer();
  timer = setInterval(updateTimer, 250);
}

function answersMatch(answer, selected, option) {
  if (answer === undefined || answer === null) return false;

  const answerString = String(answer).trim().toLowerCase();

  const optionLabel = typeof option === "object"
    ? String(option.text ?? option.label ?? option.value ?? "")
    : String(option);

  return answerString === String(selected).toLowerCase() ||
    answerString === String(optionLabel).trim().toLowerCase();
}

async function advanceTurn(skipped = false, correct = false) {
  if (!game || game.currentPlayerUid !== uid || advancing || !roomCode) return;

  advancing = true;

  try {
    const players = game.playerOrder || [];

    if (players.length !== 2) {
      throw new Error("The room must have two players.");
    }

    const nextIndex = Number(game.currentQuestionIndex || 0) + 1;
    const currentPlayerIndex = players.indexOf(uid);
    const nextUid = players[(Math.max(0, currentPlayerIndex) + 1) % players.length];
    const scores = { ...(game.scores || {}) };

    if (correct) {
      scores[uid] = Number(scores[uid] || 0) + 1;
    }

    const total = game.questionIds?.length || game.questions?.length || 0;

    await updateDoc(
      doc(db, "rooms", roomCode, "gameState", "current"),
      {
        currentQuestionIndex: nextIndex,
        currentPlayerUid: nextUid,
        scores,
        status: nextIndex >= total ? "finished" : "playing",
        turnEndsAt: Date.now() + 30000,
        lastAction: skipped ? "skipped" : "answered",
        lastActionBy: uid
      }
    );

    chosen = null;
    submitted = false;
    question = null;
    questionKey = "";
  } finally {
    advancing = false;
  }
}

// Create room
$("createRoom").addEventListener("click", async () => {
  try {
    clearNotice();

    if (!profile.displayName) await saveCurrentProfile();

    const code = await createRoom(profile);
    watchRoom(code);

    showNotice("Room created! Share the code with your opponent.", false);
  } catch (error) {
    console.error(error);
    showNotice(error.message || "Could not create room.");
  }
});

// Join room
$("joinRoom").addEventListener("click", async () => {
  try {
    clearNotice();

    if (!profile.displayName) await saveCurrentProfile();

    const code = await joinRoom($("roomCode").value, profile);
    watchRoom(code);

    showNotice("Joined room successfully!", false);
  } catch (error) {
    console.error(error);
    showNotice(error.message || "Could not join room.");
  }
});

// Start game
$("startGame").addEventListener("click", async () => {
  try {
    $("startGame").disabled = true;

    await startGame(roomCode);

    showNotice("Game started! ❤️‍🔥", false);
  } catch (error) {
    console.error(error);
    showNotice("Could not start game: " + error.message);
  } finally {
    $("startGame").disabled = false;
  }
});

// Submit answer
$("submitAnswer").addEventListener("click", async () => {
  if (!game || game.currentPlayerUid !== uid || submitted) return;

  if (question?.options?.length && chosen === null) {
    showNotice("Choose an answer first.");
    return;
  }

  submitted = true;
  $("submitAnswer").disabled = true;
  $("skipQuestion").disabled = true;

  const option = question?.options?.[chosen];
  const correct = question?.options?.length
    ? answersMatch(question.answer, chosen, option)
    : false;

  $("answerFeedback").textContent = correct
    ? "Correct! +1 point"
    : "Answer submitted.";

  try {
    await advanceTurn(false, correct);
  } catch (error) {
    submitted = false;
    showNotice("Could not submit answer: " + error.message);
  }
});

// Skip question
$("skipQuestion").addEventListener("click", async () => {
  if (!game || game.currentPlayerUid !== uid || submitted) return;

  submitted = true;

  try {
    await advanceTurn(true, false);
  } catch (error) {
    submitted = false;
    showNotice("Could not skip: " + error.message);
  }
});

// Return to lobby
$("returnLobby").addEventListener("click", () => {
  cleanRoom();
  showNotice("You left the room view. Your room remains in Firebase.", false);
});

// Chat
$("chatForm").addEventListener("submit", async event => {
  event.preventDefault();

  const messageText = $("chTurn || submitted;
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
