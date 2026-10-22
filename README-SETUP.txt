PICK & ANSWER v3 — UPDATED REPLACEMENT PACKAGE
================================================

WHAT CHANGED
------------
- Bulk question upload in the room creator's panel.
- Questions are numbered automatically.
- Players pick a question number FOR the other player.
- A picked number is reserved atomically in Firestore and cannot be picked again.
- No answer submission form, answer history, score, or leaderboard.
- Room chat, profiles, avatars, room creation/joining, and the existing admin files remain.
- Browser notification permission for new room messages when the page is running.

FILES
-----
index.html, app.js, firebase.js, styles.css, firestore.rules, README-SETUP.txt
admin.html, admin.js, admin.css are included unchanged from your uploaded ZIP.

INSTALL
-------
1. Back up your GitHub repository first.
2. Upload/replace the files from this ZIP in the ROOT of the repository. Keep the three
   admin files unchanged; this ZIP includes the original copies.
3. Firebase Console > Firestore Database > Rules: paste the full contents of firestore.rules
   and publish. The admin email in these rules is victorolayemi72@gmail.com. If you use a
   different verified Google email for admin, change that email before publishing.
4. Firebase Console > Authentication > Sign-in method: enable Anonymous for players and
   Google for admin. Ensure your GitHub Pages domain is an authorized domain.
5. Commit the changes and wait for GitHub Pages to deploy. Open the game in two browsers or
   on two devices, save each profile, create a room, and join with the six-character code.

BULK QUESTION FORMAT
--------------------
- Paste one question per line, OR separate multi-line questions with a blank line.
- Optional leading numbering like "1. ", "2) ", or bullets are stripped automatically.
- Choose one category for each upload.
- Up to 400 questions per upload; each question must be 1,000 characters or fewer.
- Additional uploads continue numbering after the highest existing question number.

HOW THE GAME WORKS
------------------
- Creator uploads questions, then presses Start game after the second player joins.
- The player whose turn it is chooses an available number for their opponent.
- The selected number disappears from the available-number grid for both players.
- The picked question appears with the name of the picker and recipient. Players can discuss
  their answers in room chat; the game does not collect answers or keep scores.

NOTIFICATIONS LIMIT
-------------------
The button requests browser notification permission for new chat messages while the page is
open or running in a supported background tab. This is NOT full push notification support
when the site is fully closed. True closed-app push requires a service worker, Firebase Cloud
Messaging configuration, and a trusted sender such as a Firebase Cloud Function; that has not
been deployed or tested in this package.

TESTING / SAFETY NOTES
---------------------
JavaScript syntax and HTML parsing checks passed locally. Live Firebase sign-in, deployed
Firestore rules, two-device gameplay, and browser notification delivery have not been tested
against your actual Firebase project from this environment. If you see "Missing or insufficient
permissions", confirm the rules were published and Anonymous sign-in is enabled.
This is a browser prototype; do not use it for sensitive information. Firestore usage may incur
costs as usage grows.
