import {
  auth,
  db,
  signInGuest,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  setDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  saveProfile,
  loadProfile,
  createRoom,
  joinRoom,
  startGame
} from "./firebase.js";

const $ = id => document.getElementById(id);

const AVATARS = [
  "🐼", "🐻", "🐱", "🦊", "🐸", "🐨",
  "🐰", "🐯", "🐶", "🦁", "🐵", "🐧",
  "🦄", "🐙", "🐹", "🐼", "🐷", "🐮",
  "🐣", "🦋", "🐺", "🐻‍❄️", "🐢", "🦉"
];

let uid = null;

let profile = {
  displayName: "",
  avatar: "🐼",
  photoURL: ""
};

let roomCode = null;
let roomUnsubs = [];
let game = null;
let question = null;
let chosen = null;
let tick = null;
let deadline = 0;
let roomCreator = false;
let submitted = false;

const notice = (msg, bad = true) => {
  $("notice").textContent = msg;
  $("notice").classList.add("show");
  $("notice").style.background = bad ? "#fff0d8" : "#e8faef";
  $("notice").style.color = bad ? "#6d4313" : "#185c36";
};

const clearNotice = () => {
  $("notice").classList.remove("show");
};

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function avatarHTML(player, large = false) {
  const cls = large ? "avatar large" : "avatar";

  if (player?.photoURL) {
    return `
      <div class="${cls}">
        <img
          src="${escapeHTML(player.photoURL)}"
          alt="${escapeHTML(player.displayName || "Player")}'s picture"
        >
      </div>
    `;
  }

  return `
    <div class="${cls}">
      ${escapeHTML(player?.avatar || "🐼")}
    </div>
  `;
}

function renderMyAvatar() {
  $("myAvatar").innerHTML = profile.photoURL
    ? `<img src="${escapeHTML(profile.photoURL)}" alt="Your profile picture">`
    : escapeHTML(profile.avatar || "🐼");

  $("pictureStatus").textContent = profile.photoURL
    ? "Your own picture is selected. Choose another picture or use an avatar."
    : "You're using an avatar. You can also select a picture from your phone.";
}

function drawAvatarChoices() {
  $("avatarChoices").innerHTML = AVATARS.map(avatar => `
    <button
      type="button"
      class="avatar-choice ${!profile.photoURL && profile.avatar === avatar ? "selected" : ""}"
      data-avatar="${avatar}"
      aria-label="Choose avatar ${avatar}"
    >${avatar}</button>
  `).join("");

  $("avatarChoices").querySelectorAll("button").forEach(button => {
    button.onclick = () => {
      profile.avatar = button.dataset.avatar;
      profile.photoURL = "";
      $("profilePicture").value = "";
      renderMyAvatar();
      drawAvatarChoices();
    };
  });
}

/*
 * Compress the selected image using the phone's browser.
 * The smaller image is saved in Firestore as a data URL.
 * Firebase Storage is not required.
 */
async function compressImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }

  if (file.size > 12 * 1024 * 1024) {
    throw new Error("That picture is too large. Choose an image under 12 MB.");
  }

  const imageURL = URL.createObjectURL(file);

  try {
    const image = new Image();

    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Could not open that picture."));
      image.src = imageURL;
    });

    const canvas = document.createElement("canvas");
    const size = 256;

    canvas.width = size;
    canvas.height = size;

    const context = canvas.getContext("2d");

    const side = Math.min(image.width, image.height);
    const sx = (image.width - side) / 2;
    const sy = (image.height - side) / 2;

    context.drawImage(
      image,
      sx,
      sy,
      side,
      side,
      0,
      0,
      size,
      size
    );

    let quality = 0.75;
    let dataURL = canvas.toDataURL("image/jpeg", quality);

    while (dataURL.length > 180000 && quality > 0.35) {
      quality -= 0.1;
      dataURL = canvas.toDataURL("image/jpeg", quality);
    }

    if (dataURL.length > 180000) {
      throw new Error("This picture could not be compressed enough. Try another.");
    }

    return dataURL;
  } finally {
    URL.revokeObjectURL(imageURL);
  }
}

$("profilePicture").addEventListener("change", async event => {
  const file = event.target.files?.[0];

  if (!file) return;

  try {
    clearNotice();
    $("pictureStatus").textContent = "Preparing your picture…";

    const compressed = await compressImage(file);

    profile.photoURL = compressed;

    renderMyAvatar();
    drawAvatarChoices();

    notice("Picture selected! Tap Save profile to keep it.", false);
  } catch (error) {
    notice(error.message || "Could not select that picture.");
    $("pictureStatus").textContent = "Try choosing another picture.";
  }
});

$("useAvatar").onclick = () => {
  profile.photoURL = "";
  $("profilePicture").value = "";

  renderMyAvatar();
  drawAvatarChoices();

  notice("Avatar selected. Save your profile to keep this choice.", false);
};

async function saveCurrentProfile() {
  if (!uid) {
    throw new Error("Please wait for the game to connect.");
  }

  const name = $("displayName").value.trim();

  if (name.length < 2) {
    throw new Error("Enter a display name with at least 2 characters.");
  }

  profile.displayName = name;

  await saveProfile(uid, profile);

  if (roomCode) {
    await setDoc(
      doc(db, "rooms", roomCode, "players", uid),
      {
        uid,
        displayName: profile.displayName,
        avatar: profile.avatar || "🐼",
        photoURL: profile.photoURL || "",
        updatedAt: serverTimestamp()
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

function cleanRoom() {
  roomUnsubs.forEach(unsubscribe => unsubscribe());
  roomUnsubs = [];

  if (tick) clearInterval(tick);

  roomCode = null;
  game = null;
  question = null;
  chosen = null;
  submitted = false;

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

  $("roomLabel").textContent = `ROOM CODE: ${code}`;
  $("returnLobby").classList.remove("hidden");

  const roomRef = doc(db, "rooms", code);

  roomUnsubs.push(
    onSnapshot(collection(db, "rooms", code, "players"), snapshot => {
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

      getDoc(roomRef).then(room => {
        roomCreator = room.exists() && room.data().createdBy === uid;

        if (
          players.length === 2 &&
          roomCreator &&
          room.data().status === "waiting"
        ) {
          $("startGame").classList.remove("hidden");
        } else {
          $("startGame").classList.add("hidden");
        }
      }).catch(error => {
        notice("Could not load room details: " + error.message);
      });
    })
  );

  roomUnsubs.push(
    onSnapshot(
      doc(db, "rooms", code, "gameState", "current"),
      snapshot => {
        if (snapshot.exists()) {
          game = snapshot.data();

          $("lobbyCard").classList.add("hidden");
          $("gameCard").classList.remove("hidden");
          $("chatCard").classList.remove("hidden");

          renderGame();
        } else {
          $("lobbyCard").classList.remove("hidden");
        }
      }
    )
  );

  roomUnsubs.push(
    onSnapshot(
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

        $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
      },
      error => {
        console.error("Chat listener:", error);
      }
    )
  );
}

async function getCurrentQuestion() {
  if (!game?.questionIds?.length) return null;

  const questionId = game.questionIds[game.currentQuestionIndex];

  if (!questionId) return null;

  const snapshot = await getDoc(doc(db, "questions", questionId));

  if (!snapshot.exists()) return null;

  const raw = snapshot.data();

  return {
    id: questionId,
    text: raw.text || raw.question || raw.questionText || "Question",
    category: raw.category || "General",
    options: Array.isArray(raw.options)
      ? raw.options
      : Array.isArray(raw.choices)
        ? raw.choices
        : [],
    answer: raw.answer ?? raw.correctAnswer ?? null
  };
}

async function renderGame() {
  if (!game) return;

  const index = game.currentQuestionIndex || 0;
  const total = game.questionIds?.length || 0;

  if (game.status === "finished" || index >= total) {
    $("questionText").textContent = "Game complete!";
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
