import {
  auth, db, signInGuest, onAuthStateChanged,
  collection, doc, getDoc, getDocs, addDoc,
  updateDoc, setDoc, query, orderBy, limit,
  onSnapshot, serverTimestamp, saveProfile,
  loadProfile, createRoom, joinRoom, startGame
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
let game = null;
let question = null;
let chosen = null;
let submitted = false;
let saving = false;
let advancing = false;
let timer = null;
let questionKey = "";
let deadline = 0;
let roomListeners = [];

function notice(message, bad = true) {
  const box = $("notice");
  if (!box) return;

  box.textContent = message;
  box.classList.add("show");
  box.style.background = bad ? "#fff0d8" : "#e8faef";
  box.style.color = bad ? "#6d4313" : "#185c36";
}

function clearNotice() {
  $("notice")?.classList.remove("show");
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

// PROFILE PICTURE DISPLAY

function renderMyAvatar() {
  const box = $("myAvatar");
  if (!box) return;

  if (profile.photoURL) {
    const image = document.createElement("img");
    image.src = profile.photoURL;
    image.alt = "Your profile picture";
    box.replaceChildren(image);
  } else {
    box.textContent = profile.avatar || "🐼";
  }

  if ($("pictureStatus")) {
    $("pictureStatus").textContent = profile.photoURL
      ? "Picture selected. Tap Save profile to keep it."
      : `Using avatar ${profile.avatar || "🐼"}.`;
  }
}

function avatarHTML(player) {
  const box = document.createElement("div");
  box.className = "avatar";

  if (player?.photoURL) {
    const image = document.createElement("img");
    image.src = player.photoURL;
    image.alt = "Player profile picture";
    box.appendChild(image);
  } else {
    box.textContent = player?.avatar || "🐼";
  }

  return box.outerHTML;
}

// AVATAR CHOICES

function drawAvatarChoices() {
  const container = $("avatarChoices");
  if (!container) return;

  container.innerHTML = "";

  AVATARS.forEach(avatar => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "avatar-choice";
    button.textContent = avatar;
    button.setAttribute("aria-label", `Choose avatar ${avatar}`);

    if (!profile.photoURL && profile.avatar === avatar) {
      button.classList.add("selected");
    }

    button.addEventListener("click", () => {
      profile.avatar = avatar;
      profile.photoURL = "";

      $("profilePicture").value = "";

      renderMyAvatar();
      drawAvatarChoices();

      notice("Avatar selected! Tap Save profile.", false);
    });

    container.appendChild(button);
  });
}

// COMPRESS PICTURE BEFORE SAVING

async function compressImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Please select a valid image.");
  }

  if (file.size > 12 * 1024 * 1024) {
    throw new Error("Choose a picture smaller than 12 MB.");
  }

  const url = URL.createObjectURL(file);

  try {
    const image = new Image();

    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(
        new Error("Could not open the selected picture.")
      );
      image.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Picture processing is unavailable.");
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

    for (let quality = 0.75; quality >= 0.25; quality -= 0.1) {
      const result = canvas.toDataURL("image/jpeg", quality);

      if (result.length <= 180000) {
        return result;
      }
    }

    throw new Error("Picture is too large. Choose another picture.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

// PICTURE UPLOAD BUTTON

$("profilePicture").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;

  notice("Processing picture...", false);

  try {
    const compressedPicture = await compressImage(file);

    profile.photoURL = compressedPicture;

    renderMyAvatar();
    drawAvatarChoices();

    notice("Picture ready! Tap Save profile.", false);
  } catch (error) {
    event.target.value = "";
    notice(error.message || "Could not process picture.");
  }
});

// USE AVATAR BUTTON

$("useAvatar").addEventListener("click", () => {
  profile.photoURL = "";
  $("profilePicture").value = "";

  renderMyAvatar();
  drawAvatarChoices();

  notice("Choose an avatar below.", false);

  $("avatarChoices").scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
});

// SAVE PROFILE

async function saveCurrentProfile() {
  if (!uid) {
    throw new Error("Firebase sign-in is not ready. Try again.");
  }

  const name = $("displayName").value.trim();

  if (name.length < 2) {
    throw new Error("Enter a name with at least 2 characters.");
  }

  profile.displayName = name.slice(0, 24);

  // Save the name, avatar and compressed picture.
  await saveProfile(uid, profile);

  // Update the player's room profile if currently in a room.
  if (roomCode) {
    await setDoc(
      doc(db, "rooms", roomCode, "players", uid),
      {
        uid,
        displayName: profile.displayName,
        avatar: profile.avatar,
        photoURL: profile.photoURL || ""
      },
      { merge: true }
    );
  }

  localStorage.setItem(
    "pickAnswerProfile",
    JSON.stringify(profile)
  );

  renderMyAvatar();
  drawAvatarChoices();

  notice("Profile saved successfully! ❤️", false);
}

$("saveProfile").addEventListener("click", async () => {
  if (saving) return;

  saving = true;
  $("saveProfile").disabled = true;

  try {
    await saveCurrentProfile();
  } catch (error) {
    console.error("Profile save failed:", error);
    notice("Could not save profile: " + error.message);
  } finally {
    saving = false;
    $("saveProfile").disabled = false;
  }
});

// ROOM LISTENERS

function stopRoomListeners() {
  roomListeners.forEach(unsubscribe => {
    try {
      unsubscribe();
    } catch {}
  });

  roomListeners = [];

  if (timer) clearInterval(timer);
  timer = null;
}

function cleanRoom() {
  stopRoomListeners();

  roomCode = null;
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

  const playersUnsub = onSnapshot(
    collection(db, "rooms", code, "players"),
    snapshot => {
      $("players").innerHTML = snapshot.docs.map(item => {
        const player = item.data();

        return `
          <div class="player">
            ${avatarHTML(player)}
            <div>
              <strong>${escapeHTML(player.displayName || "Player")}</strong>
              <div class="muted">
                ${player.uid === uid ? "You" : "Your opponent"}
              </div>
            </div>
          </div>
        `;
      }).join("");

      refreshRoomControls();
    },
    error => notice("Players error: " + error.message)
  );

  roomListeners.push(playersUnsub);

  const roomUnsub = onSnapshot(
    doc(db, "rooms", code),
    snapshot => {
      if (!snapshot.exists()) {
        notice("This room no longer exists.");
        return;
      }

      const room = snapshot.data();

      $("startGame").classList.toggle(
        "hidden",
        !(room.createdBy === uid && room.status === "waiting")
      );

      if (room.status === "playing" || room.status === "finished") {
        $("gameCard").classList.remove("hidden");
        $("chatCard").classList.remove("hidden");
      }
    },
    error => notice("Room error: " + error.message)
  );

  roomListeners.push(roomUnsub);

  const gameUnsub = onSnapshot(
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
        console.error(error);
        notice("Game error: " + error.message);
      });
    },
    error => notice("Game state error: " + error.message)
  );

  roomListeners.push(gameUnsub);

  const chatUnsub = onSnapshot(
    query(
      collection(db, "rooms", code, "messages"),
      orderBy("createdAt", "asc"),
      limit(100)
    ),
    snapshot => {
      $("chatMessages").innerHTML = snapshot.docs.map(item => {
        const message = item.data();

        return `
          <div class="message ${message.uid === uid ? "mine" : ""}">
            <strong>${escapeHTML(message.displayName || "Player")}</strong>
            <div>${escapeHTML(message.text || "")}</div>
          </div>
        `;
      }).join("");

      $("chatMessages").scrollTop =
        $("chatMessages").scrollHeight;
    },
    error => notice("Chat error: " + error.message)
  );

  roomListeners.push(chatUnsub);
  refreshRoomControls();
}

async function refreshRoomControls() {
  if (!roomCode) return;

  try {
    const roomSnapshot = await getDoc(doc(db, "rooms", roomCode));
    if (!roomSnapshot.exists()) return;

    const playersSnapshot = await getDocs(
      collection(db, "rooms", roomCode, "players")
    );

    const room = roomSnapshot.data();

    $("startGame").classList.toggle(
      "hidden",
      !(
        room.createdBy === uid &&
        room.status === "waiting" &&
        playersSnapshot.size === 2
      )
    );
  } catch (error) {
    console.error("Room controls:", error);
  }
}

// QUESTION HELPERS

function normalizeQuestion(data = {}) {
  let options = data.options ?? data.Options ?? data.choices ?? [];

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
    text: String(
      data.text ?? data.Text ?? data.question ?? data.Question ?? ""
    ),
    category: String(data.category ?? data.Category ?? "General"),
    options,
    answer: data.answer ?? data.Answer ?? data.correctAnswer
  };
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

function renderScores() {
  $("scores").innerHTML = (game?.playerOrder || []).map(id => `
    <div class="score">
      ${id === uid ? "You" : "Opponent"}:
      <strong>${Number(game?.scores?.[id] || 0)}</strong>
    </div>
  `).join("");
}

function answersMatch(answer, selected, option) {
  if (answer === undefined || answer === null) return false;

  const label = typeof option === "object"
    ? option.text ?? option.label ?? option.value ?? ""
    : option;

  const a = String(answer).trim().toLowerCase();

  return a === String(selected).toLowerCase() ||
    a === String(label).trim().toLowerCase() ||
    a === String(Number(selected) + 1);
}

// GAME DISPLAY

async function renderGame() {
  if (!game) return;

  renderScores();

  const index = Number(game.currentQuestionIndex || 0);
  const total = game.questionIds?.length || game.questions?.length || 0;

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

    if (!question) {
      $("questionText").textContent = "Question not found.";
      $("category").textContent = "Question error";
      $("options").innerHTML = "";
      return;
    }

    $("questionText").textContent = question.text;
    $("category").textContent = question.category;
    $("answerFeedback").textContent = "";

    $("options").innerHTML = question.options.map((option, i) => {
      const label = typeof option === "object"
        ? option.text ?? option.label ?? String(option.value ?? "")
        : String(option);

      return `
        <button type="button" class="option" data-index="${i}">
          ${escapeHTML(label)}
        </button>
      `;
    }).join("");

    $("options").querySelectorAll("[data-index]").forEach(button => {
      button.addEventListener("click", () => {
        if (submitted || game?.currentPlayerUid !== uid) return;

        chosen = Number(button.dataset.index);

        $("options").querySelectorAll(".option").forEach(item => {
          item.classList.toggle("selected", item === button);
        });
      });
    });
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

  const tick = async () => {
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
          notice("Could not advance turn: " + error.message);
        }
      }
    }
  };

  tick();
  timer = setInterval(tick, 250);
}

async function advanceTurn(skipped = false, correct = false) {
  if (
    !game ||
    game.currentPlayerUid !== uid ||
    advancing ||
    !roomCode
  ) return;

  advancing = true;

  try {
    const players = game.playerOrder || [];

    if (players.length !== 2) {
      throw new Error("The room must have two players.");
    }

    const nextIndex = Number(game.currentQuestionIndex || 0) + 1;
    const myIndex = players.indexOf(uid);
    const nextUid = players[(Math.max(0, myIndex) + 1) % 2];

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

// CREATE ROOM

$("createRoom").addEventListener("click", async () => {
  try {
    clearNotice();

    if (!profile.displayName) await saveCurrentProfile();

    const code = await createRoom(profile);

    watchRoom(code);
    notice("Room created! Share the code with your opponent.", false);
  } catch (error) {
    console.error(error);
    notice("Could not create room: " + error.message);
  }
});

// JOIN ROOM

$("joinRoom").addEventListener("click", async () => {
  try {
    clearNotice();

    if (!profile.displayName) await saveCurrentProfile();

    const code = await joinRoom($("roomCode").value, profile);

    watchRoom(code);
    notice("Joined room successfully!", false);
  } catch (error) {
    console.error(error);
    notice("Could not join room: " + error.message);
  }
});

// START GAME

$("startGame").addEventListener("click", async () => {
  try {
    $("startGame").disabled = true;

    await startGame(roomCode);

    notice("Game started! ❤️‍🔥", false);
  } catch (error) {
    console.error(error);
    notice("Could not start game: " + error.message);
  } finally {
    $("startGame").disabled = false;
  }
});

// SUBMIT ANSWER

$("submitAnswer").addEventListener("click", async () => {
  if (!game || game.currentPlayerUid !== uid || submitted) return;

  if (question?.options?.length && chosen === null) {
    notice("Choose an answer first.");
    return;
  }

  submitted = true;

  const option = question?.options?.[chosen];
  const correct = question?.options?.length
    ? answersMatch(question.answer, chosen, option)
    : false;

  $("submitAnswer").disabled = true;
  $("skipQuestion").disabled = true;

  $("answerFeedback").textContent = correct
    ? "Correct! +1 point"
    : "Answer submitted.";

  try {
    await advanceTurn(false, correct);
  } catch (error) {
    submitted = false;
    notice("Could not submit answer: " + error.message);
  }
});

// SKIP QUESTION

$("skipQuestion").addEventListener("click", async () => {
  if (!game || game.currentPlayerUid !== uid || submitted) return;

  submitted = true;

  try {
    await advanceTurn(true, false);
  } catch (error) {
    submitted = false;
    notice("Could not skip: " + error.message);
  }
});

// RETURN TO LOBBY

$("returnLobby").addEventListener("click", () => {
  cleanRoom();
  notice("You left the room view. Your room remains in Firebase.", false);
});

// CHAT

$("chatForm").addEventListener("submit", async event => {
  event.preventDefault();

  const message = $("chatInput").value.trim();

  if (!message || !roomCode || !uid) return;

  try {
    await addDoc(
      collection(db, "rooms", roomCode, "messages"),
      {
        uid,
        displayName: profile.displayName,
        text: message.slice(0, 500),
        createdAt: serverTimestamp()
      }
    );

    $("chatInput").value = "";
  } catch (error) {
    console.error(error);
    notiage)
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
    console.error("Profile loading failed:", error);

    renderMyAvatar();
    drawAvatarChoices();

    notice("Could not load profile: " + error.message);
  }
});

signInGuest().catch(error => {
  console.error("Firebase sign-in failed:", error);
  notice("Firebase sign-in failed: " + error.message);
});

// Show avatar choices immediately, even before sign-in completes.
renderMyAvatar();
drawAvatarChoices();
