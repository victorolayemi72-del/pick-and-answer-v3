PICK & ANSWER — REPLACEMENT FILES

Included:
- index.html
- app.js
- firebase.js
- styles.css

The Firebase config is already inserted in firebase.js. Do not upload or replace your admin.html, admin.js, or other Admin Panel files.

IMPORTANT BEFORE DEPLOYING
1. Download/backup your current four files first.
2. Replace index.html, app.js, firebase.js, and styles.css in your GitHub repository with these files.
3. Also replace the Firestore Rules with the rules supplied separately in the chat.
4. Publish the rules in Firebase Console > Firestore Database > Rules.
5. Commit and push the four files to GitHub. Wait for GitHub Pages to redeploy, then refresh the site.
6. Test with two different player accounts/devices.

Current implementation notes:
- Questions are room-specific and creator-managed.
- Players type open-ended answers; no scores are awarded.
- The 30-second timer does not force submission or switch turns when it reaches zero.
- Submitting or skipping advances to the next question and switches player.
- The game state stores a question snapshot in one document. Extremely large rooms may eventually reach Firestore's document-size limit; practical use should stay within that limit.
- This is a starter replacement; test permissions and gameplay before sharing publicly.
