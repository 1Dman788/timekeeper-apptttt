import { auth, db } from './firebase-init.js';
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';

const loginForm = document.getElementById('loginForm');
const errorMessage = document.getElementById('error-message');

// Handle form submission for login
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorMessage.textContent = '';
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    try {
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );
      const user = userCredential.user;
      // After login, fetch role from users collection
      const userDocRef = doc(db, 'users', user.uid);
      const userDocSnap = await getDoc(userDocRef);
      if (userDocSnap.exists()) {
        const data = userDocSnap.data();
        if (data.role === 'admin') {
          window.location.href = 'admin.html';
        } else {
          window.location.href = 'employee.html';
        }
      } else {
        errorMessage.textContent =
          'Account exists in Auth but not in database. Please contact administrator.';
      }
    } catch (error) {
      console.error('Login error:', error);
      errorMessage.textContent = error.message;
    }
  });
}

// If user is already authenticated, redirect accordingly
onAuthStateChanged(auth, async (user) => {
  if (user) {
    // Already signed in; fetch role to redirect
    const userDocRef = doc(db, 'users', user.uid);
    const userDocSnap = await getDoc(userDocRef);
    if (userDocSnap.exists()) {
      const data = userDocSnap.data();
      const pathname = window.location.pathname;
      // Avoid redirect loops: only redirect if currently on login page
      if (pathname.endsWith('/index.html') || pathname === '/' || pathname.endsWith('/')) {
        if (data.role === 'admin') {
          window.location.href = 'admin.html';
        } else {
          window.location.href = 'employee.html';
        }
      }
    }
  }
});