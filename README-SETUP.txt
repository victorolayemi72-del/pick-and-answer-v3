PICK & ANSWER — COMPLETE REPLACEMENT FILES
==========================================

FILES
-----
index.html       Main game
styles.css       Main design
firebase.js      Firebase connection and shared functions
app.js           Profiles, photo/avatar picker, rooms, turns, timer, scores, chat
admin.html       Admin panel
admin.css        Admin panel styling
admin.js         Admin Google sign-in and question manager
firestore.rules  Firestore access rules

INSTALL
-------
1. Replace the existing files in the root of your GitHub repository with these files.
   Important: the main HTML references styles.css (plural), not style.css.
2. In Firebase Console > Authentication > Sign-in method, enable:
   - Anonymous (for game players)
   - Google (for the admin panel)
3. In Firebase Console > Authentication > Settings > Authorized domains, make sure
   victorolayemi72-del.github.io is listed.
4. Open Firebase Console > Firestore Database > Rules.
5. Copy firestore.rules into the Rules editor.
6. Before publishing the rules, replace:
   REPLACE_WITH_YOUR_GOOGLE_EMAIL
   with the exact Google email you will use for admin access. Keep the quotation marks.
7. Publish the rules.
8. In Firebase Console > Project settings > General, the web app config should match
   the project in firebase.js (pick-and-answer-v3).
9. Commit/push the replacement files and wait for GitHub Pages to deploy.
10. Open the main game, refresh, save a profile, create a room. A second player must
    open the same site on another browser/device and join with the room code.
11. Open admin.html and sign in using the Google email entered in firestore.rules.
    Add questions with at least two options. The answer selected in the dropdown must
    correspond to an option that is filled in.

IMPORTANT LIMITS / NOTES
------------------------
- The Google email used by the admin page is not automatically the Firebase Console
  account unless it is the same Google account. Enter the exact email in the rules.
- The browser app does not have access to your Firebase Console credentials.
- Photos are resized in the browser and stored as compressed data URLs in Firestore;
  this avoids Firebase Storage setup, but many large photos can increase Firestore use.
- This is a starter two-player game. Do not use it for sensitive/private information.
- For strongest production security, game-state turn changes should be validated by a
  trusted server/Cloud Function. These client rules prioritize getting the prototype
  running and should be hardened before public launch.
- If you see "Missing or insufficient permissions", check the published Firestore rules,
  that Anonymous sign-in is enabled, and that the admin email placeholder was replaced.
