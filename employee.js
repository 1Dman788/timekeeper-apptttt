import { auth, db } from './firebase-init.js';
import {
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  getDoc,
  Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';

// DOM references
const punchStatus = document.getElementById('punch-status');
const punchBtn = document.getElementById('punchBtn');
const historyContainer = document.getElementById('history-container');
const logoutBtn = document.getElementById('logoutBtn');

let currentUser = null;
let currentUserData = null;
let currentShiftDocId = null;
let payPeriodStartDate = null;

// Format date as YYYY-MM-DD
function formatDateISO(date) {
  return date.toISOString().slice(0, 10);
}

// Format day of week (e.g., Mon)
function dayOfWeek(date) {
  return date.toLocaleDateString(undefined, { weekday: 'short' });
}

// Format time for display (HH:MM)
function formatTime(ts) {
  if (!ts) return '';
  let dateObj;
  if (typeof ts === 'string') {
    dateObj = new Date(ts);
  } else if (ts.toDate) {
    dateObj = ts.toDate();
  } else if (ts instanceof Date) {
    dateObj = ts;
  } else {
    dateObj = new Date();
  }
  return dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Calculate hours worked rounded to nearest minute
function calculateHours(startTs, endTs) {
  if (!startTs || !endTs) return 0;
  let startDate;
  let endDate;
  if (startTs.toDate) startDate = startTs.toDate();
  else startDate = new Date(startTs);
  if (endTs.toDate) endDate = endTs.toDate();
  else endDate = new Date(endTs);
  const diffMs = endDate - startDate;
  const minutes = Math.round(diffMs / (1000 * 60));
  return minutes / 60;
}

// Fetch global settings (pay period start date)
async function fetchSettings() {
  try {
    const settingsRef = doc(db, 'settings', 'config');
    const settingsSnap = await getDoc(settingsRef);
    if (settingsSnap.exists()) {
      const data = settingsSnap.data();
      if (data.payPeriodStartDate) {
        payPeriodStartDate = new Date(data.payPeriodStartDate);
      }
    }
  } catch (error) {
    console.error('Error fetching settings:', error);
  }
}

// Determine current pay period start and end dates
function getCurrentPayPeriod() {
  const today = new Date();
  if (!payPeriodStartDate) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((today - payPeriodStartDate) / msPerDay);
  const periodIndex = Math.floor(diffDays / 14);
  const periodStart = new Date(
    payPeriodStartDate.getTime() + periodIndex * 14 * msPerDay
  );
  const periodEnd = new Date(periodStart.getTime() + 13 * msPerDay);
  return { periodStart, periodEnd };
}

// Load punch status for today
async function loadPunchStatus() {
  if (!currentUser) return;
  const todayStr = formatDateISO(new Date());
  currentShiftDocId = null;
  // Query for today's shift
  const shiftQuery = query(
    collection(db, 'shifts'),
    where('uid', '==', currentUser.uid),
    where('date', '==', todayStr)
  );
  const shiftSnap = await getDocs(shiftQuery);
  if (shiftSnap.empty) {
    punchStatus.textContent = 'You have not punched in today.';
    punchBtn.textContent = 'Punch In';
    punchBtn.disabled = false;
    return;
  }
  // Assume one shift per day
  const docSnap = shiftSnap.docs[0];
  currentShiftDocId = docSnap.id;
  const shift = docSnap.data();
  const timeIn = shift.timeIn || null;
  const timeOut = shift.timeOut || null;
  if (!timeOut) {
    // Currently punched in
    punchStatus.textContent = `Punched in at ${formatTime(timeIn)}.`;
    punchBtn.textContent = 'Punch Out';
    punchBtn.disabled = false;
  } else {
    // Already punched out
    punchStatus.textContent = `Already punched out at ${formatTime(timeOut)}.`;
    punchBtn.textContent = 'Punch In';
    punchBtn.disabled = true;
  }
}

// Load shift history and display
async function loadHistory() {
  if (!currentUser) return;
  historyContainer.innerHTML = '';
  // Fetch all shifts for user
  const shiftsQuery = query(
    collection(db, 'shifts'),
    where('uid', '==', currentUser.uid)
  );
  const shiftsSnap = await getDocs(shiftsQuery);
  const shifts = [];
  shiftsSnap.forEach((doc) => {
    shifts.push({ id: doc.id, ...doc.data() });
  });
  // Sort by date ascending
  shifts.sort((a, b) => (a.date > b.date ? 1 : -1));
  // Build table
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  [
    'Date',
    'Day',
    'Time In',
    'Adj. In',
    'Time Out',
    'Adj. Out',
    'Hours',
    'Pay',
  ].forEach((text) => {
    const th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  let totalHours = 0;
  let totalPay = 0;
  shifts.forEach((shift) => {
    const row = document.createElement('tr');
    const dateObj = new Date(shift.date);
    const start = shift.adjTimeIn || shift.timeIn;
    const end = shift.adjTimeOut || shift.timeOut;
    const hoursWorked = calculateHours(start, end);
    const pay = hoursWorked * (currentUserData?.hourlyRate || 0);
    totalHours += hoursWorked;
    totalPay += pay;
    [
      shift.date,
      dayOfWeek(dateObj),
      formatTime(shift.timeIn),
      formatTime(shift.adjTimeIn),
      formatTime(shift.timeOut),
      formatTime(shift.adjTimeOut),
      hoursWorked.toFixed(2),
      pay.toFixed(2),
    ].forEach((text) => {
      const td = document.createElement('td');
      td.textContent = text;
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  // Summary row for current pay period (if payPeriodStartDate exists)
  const summary = document.createElement('p');
  if (payPeriodStartDate) {
    const period = getCurrentPayPeriod();
    if (period) {
      // Filter shifts within current period
      let periodHours = 0;
      let periodPay = 0;
      shifts.forEach((shift) => {
        const date = new Date(shift.date);
        if (date >= period.periodStart && date <= period.periodEnd) {
          const hours = calculateHours(
            shift.adjTimeIn || shift.timeIn,
            shift.adjTimeOut || shift.timeOut
          );
          periodHours += hours;
          periodPay += hours * (currentUserData?.hourlyRate || 0);
        }
      });
      summary.textContent = `Current Pay Period (${formatDateISO(
        period.periodStart
      )} – ${formatDateISO(period.periodEnd)}): Total Hours = ${periodHours.toFixed(
        2
      )}, Total Pay = ${periodPay.toFixed(2)}`;
    }
  } else {
    summary.textContent = `Total Hours Worked: ${totalHours.toFixed(
      2
    )}, Total Pay: ${totalPay.toFixed(2)}`;
  }
  historyContainer.appendChild(table);
  historyContainer.appendChild(summary);
}

// Punch button handler
punchBtn?.addEventListener('click', async () => {
  if (!currentUser) return;
  punchBtn.disabled = true;
  const now = new Date();
  const todayStr = formatDateISO(now);
  try {
    if (!currentShiftDocId) {
      // Punch In: create new shift document
      await addDoc(collection(db, 'shifts'), {
        uid: currentUser.uid,
        date: todayStr,
        timeIn: Timestamp.fromDate(now),
        adjTimeIn: null,
        timeOut: null,
        adjTimeOut: null,
      });
    } else {
      // Punch Out: update existing shift document
      const shiftRef = doc(db, 'shifts', currentShiftDocId);
      await updateDoc(shiftRef, {
        timeOut: Timestamp.fromDate(now),
      });
    }
    // Reload status and history after punching
    await loadPunchStatus();
    await loadHistory();
  } catch (error) {
    console.error('Error punching:', error);
    alert('An error occurred while recording your punch. Please try again.');
  } finally {
    punchBtn.disabled = false;
  }
});

// Logout button
logoutBtn?.addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = 'index.html';
});

// Initialize page by verifying auth state
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Not logged in; redirect to login
    window.location.href = 'index.html';
    return;
  }
  currentUser = user;
  // Fetch user document for hourly rate
  const userDocRef = doc(db, 'users', user.uid);
  const userDocSnap = await getDoc(userDocRef);
  if (!userDocSnap.exists()) {
    alert('User record missing. Please contact admin.');
    return;
  }
  currentUserData = userDocSnap.data();
  // If user is admin, redirect to admin dashboard
  if (currentUserData.role === 'admin') {
    window.location.href = 'admin.html';
    return;
  }
  // Fetch settings
  await fetchSettings();
  // Load current status and history
  await loadPunchStatus();
  await loadHistory();
});