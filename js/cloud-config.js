/* Solo Miner - cloud save settings.
 * Fill these in from your Firebase project (Project settings > General > Your apps > Web app > SDK setup and configuration).
 * Only apiKey and projectId are needed. Both are public by design: they identify the project, they are not passwords.
 * Player data is protected by Firebase Auth plus the Firestore security rules in the README.
 * While either value is empty the game runs exactly as before (save on this device only) and the Account screen says
 * cloud saves aren't switched on yet. */
window.SM = window.SM || {};
SM.CLOUD_CONFIG = {
  apiKey: 'AIzaSyCjVR4rxG6KCqmYx_4hbk1YyA0PwNyeJmU',
  projectId: 'solo-miner-2daec',
};
