// Firebase initialization module
// Imports required functions from the Firebase SDKs. See docs for more details
// on using the modular Web SDK: https://firebase.google.com/docs/web/learn-more#modular-api

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// Configuration provided by the user. Measurement ID is optional.
const firebaseConfig = {
  apiKey: "AIzaSyBcIBVNGyy8Bw_9TYJx7hviM0Z1LeSd22E",
  authDomain: "timekeep2test.firebaseapp.com",
  projectId: "timekeep2test",
  storageBucket: "timekeep2test.firebasestorage.app",
  messagingSenderId: "608331276389",
  appId: "1:608331276389:web:6b77bd26e63699d88c268c",
  measurementId: "G-S9JE53BMN3",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Optional analytics initialization. We call this but ignore the returned value
// since analytics are not required for core functionality.
getAnalytics(app);

// Initialize services
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };