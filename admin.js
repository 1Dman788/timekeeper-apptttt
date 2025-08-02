import { app, auth, db } from './firebase-init.js';
import {
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';

// DOM elements
const logoutBtn = document.getElementById('logoutBtn');
const employeeListContainer = document.getElementById('employee-list-container');
const createForm = document.getElementById('create-employee-form');
const newNameInput = document.getElementById('newName');
const newEmailInput = document.getElementById('newEmail');
const newHourlyInput = document.getElementById('newHourly');
const newPasswordInput = document.getElementById('newPassword');
const createEmployeeError = document.getElementById('create-employee-error');
const payPeriodInput = document.getElementById('payPeriodStartDate');
const savePayPeriodBtn = document.getElementById('savePayPeriod');
const settingsMsg = document.getElementById('settings-msg');
const employeeSelect = document.getElementById('employeeSelect');
const employeeInfo = document.getElementById('employeeInfo');
const employeeTableContainer = document.getElementById('employeeTableContainer');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const adminMessages = document.getElementById('admin-messages');

// State variables
let currentUser = null;
let employees = [];
let payPeriodStartDate = null;

// Utility functions
function formatDateISO(date) {
  return date.toISOString().slice(0, 10);
}
function dayOfWeek(date) {
  return date.toLocaleDateString(undefined, { weekday: 'short' });
}
function formatTime(ts) {
  if (!ts) return '';
  let d;
  if (typeof ts === 'string') d = new Date(ts);
  else if (ts.toDate) d = ts.toDate();
  else d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function calculateHours(startTs, endTs) {
  if (!startTs || !endTs) return 0;
  let start;
  let end;
  start = startTs.toDate ? startTs.toDate() : new Date(startTs);
  end = endTs.toDate ? endTs.toDate() : new Date(endTs);
  const diffMs = end - start;
  const minutes = Math.round(diffMs / (1000 * 60));
  return minutes / 60;
}
// Fetch pay period from settings
async function loadSettings() {
  try {
    const settingsRef = doc(db, 'settings', 'config');
    const snap = await getDoc(settingsRef);
    if (snap.exists()) {
      const data = snap.data();
      if (data.payPeriodStartDate) {
        payPeriodStartDate = new Date(data.payPeriodStartDate);
        // Set input value
        payPeriodInput.value = formatDateISO(payPeriodStartDate);
      }
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// Save pay period start date
savePayPeriodBtn?.addEventListener('click', async () => {
  settingsMsg.textContent = '';
  const val = payPeriodInput.value;
  if (!val) {
    settingsMsg.textContent = 'Please select a date.';
    return;
  }
  const selectedDate = new Date(val);
  try {
    await setDoc(
      doc(db, 'settings', 'config'),
      { payPeriodStartDate: selectedDate.toISOString() },
      { merge: true }
    );
    payPeriodStartDate = selectedDate;
    settingsMsg.textContent = 'Pay period start date saved.';
  } catch (error) {
    settingsMsg.textContent = 'Error saving date: ' + error.message;
  }
});

// Load employees list
async function loadEmployees() {
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('role', '==', 'employee'));
    const snap = await getDocs(q);
    employees = [];
    employeeSelect.innerHTML = '<option value="">--Select an employee--</option>';
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      employees.push({ id: docSnap.id, ...data });
    });
    // Populate dropdown and list
    employees.forEach((emp) => {
      const option = document.createElement('option');
      option.value = emp.id;
      option.textContent = emp.username || emp.email;
      employeeSelect.appendChild(option);
      // Also render in list
      const div = document.createElement('div');
      div.textContent = `${emp.username || emp.email} (Rate: $${(
        emp.hourlyRate || 0
      ).toFixed(2)}/hr)`;
      employeeListContainer.appendChild(div);
    });
  } catch (error) {
    console.error('Error loading employees:', error);
  }
}

// Create new employee via Identity Toolkit signUp
async function createEmployee(name, email, hourlyRate, password) {
  const apiKey = app.options.apiKey;
  const signUpUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`;
  const body = {
    email: email,
    password: password,
    returnSecureToken: true,
  };
  const resp = await fetch(signUpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await resp.json();
  if (result.error) {
    throw new Error(result.error.message);
  }
  const uid = result.localId;
  // Create Firestore user doc
  await setDoc(doc(db, 'users', uid), {
    uid: uid,
    username: name,
    email: email,
    role: 'employee',
    hourlyRate: parseFloat(hourlyRate),
  });
  return uid;
}

// Handle create employee form submission
createForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  createEmployeeError.textContent = '';
  const name = newNameInput.value.trim();
  const email = newEmailInput.value.trim();
  const hourlyRate = newHourlyInput.value;
  const password = newPasswordInput.value;
  if (!name || !email || !hourlyRate || !password) {
    createEmployeeError.textContent = 'Please fill all fields.';
    return;
  }
  try {
    await createEmployee(name, email, hourlyRate, password);
    // Clear inputs
    newNameInput.value = '';
    newEmailInput.value = '';
    newHourlyInput.value = '';
    newPasswordInput.value = '';
    // Reload employees list
    employeeListContainer.innerHTML = '';
    await loadEmployees();
    createEmployeeError.textContent = 'Employee created successfully.';
  } catch (error) {
    console.error('Error creating employee:', error);
    createEmployeeError.textContent = error.message;
  }
});

// Handle employee selection
employeeSelect?.addEventListener('change', async () => {
  const uid = employeeSelect.value;
  if (!uid) {
    employeeInfo.innerHTML = '';
    employeeTableContainer.innerHTML = '';
    exportCsvBtn.style.display = 'none';
    return;
  }
  await loadEmployeeDetail(uid);
});

// Load details and shifts for a selected employee
async function loadEmployeeDetail(uid) {
  employeeInfo.innerHTML = '';
  employeeTableContainer.innerHTML = '';
  adminMessages.textContent = '';
  exportCsvBtn.style.display = 'none';
  try {
    // Fetch employee doc
    const empDocRef = doc(db, 'users', uid);
    const empSnap = await getDoc(empDocRef);
    if (!empSnap.exists()) {
      employeeInfo.textContent = 'Employee record not found.';
      return;
    }
    const empData = empSnap.data();
    // Display basic info with editable hourly rate
    const infoDiv = document.createElement('div');
    infoDiv.innerHTML = `<strong>Name:</strong> ${empData.username || ''} <br/>
      <strong>Email:</strong> ${empData.email} <br/>`;
    const rateLabel = document.createElement('label');
    rateLabel.textContent = 'Hourly Rate:';
    rateLabel.style.marginRight = '0.5rem';
    const rateInput = document.createElement('input');
    rateInput.type = 'number';
    rateInput.step = '0.01';
    rateInput.min = '0';
    rateInput.value = (empData.hourlyRate || 0).toFixed(2);
    rateInput.addEventListener('change', async () => {
      const newRate = parseFloat(rateInput.value);
      try {
        await updateDoc(empDocRef, { hourlyRate: newRate });
        adminMessages.textContent = 'Hourly rate updated.';
        // update list display as well
        employeeListContainer.innerHTML = '';
        await loadEmployees();
      } catch (error) {
        adminMessages.textContent = 'Error updating rate: ' + error.message;
      }
    });
    const rateContainer = document.createElement('div');
    rateContainer.classList.add('form-row');
    rateContainer.appendChild(rateLabel);
    rateContainer.appendChild(rateInput);
    infoDiv.appendChild(rateContainer);
    employeeInfo.appendChild(infoDiv);
    // Fetch shifts
    const shiftQ = query(
      collection(db, 'shifts'),
      where('uid', '==', uid)
    );
    const shiftSnap = await getDocs(shiftQ);
    const shifts = [];
    shiftSnap.forEach((d) => shifts.push({ id: d.id, ...d.data() }));
    shifts.sort((a, b) => (a.date > b.date ? 1 : -1));
    // Render table
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const hdrRow = document.createElement('tr');
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
      hdrRow.appendChild(th);
    });
    thead.appendChild(hdrRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    let totalHours = 0;
    let totalPay = 0;
    for (const shift of shifts) {
      const row = document.createElement('tr');
      const dateObj = new Date(shift.date);
      // Determine hours and pay using adjustments
      const hours = calculateHours(
        shift.adjTimeIn || shift.timeIn,
        shift.adjTimeOut || shift.timeOut
      );
      const pay = hours * (empData.hourlyRate || 0);
      totalHours += hours;
      totalPay += pay;
      // Data cells
      const cells = [];
      cells.push(shift.date);
      cells.push(dayOfWeek(dateObj));
      cells.push(formatTime(shift.timeIn));
      // Adj. In editable
      const adjInTd = document.createElement('td');
      const adjInInput = document.createElement('input');
      adjInInput.type = 'datetime-local';
      adjInInput.value = shift.adjTimeIn
        ? formatDateTimeLocal(shift.adjTimeIn)
        : '';
      adjInInput.addEventListener('change', async () => {
        const val = adjInInput.value;
        try {
          await updateDoc(doc(db, 'shifts', shift.id), {
            adjTimeIn: val ? Timestamp.fromDate(new Date(val)) : null,
          });
          adminMessages.textContent = 'Adjusted time-in updated.';
          // Refresh view
          await loadEmployeeDetail(uid);
        } catch (error) {
          adminMessages.textContent =
            'Error updating adjusted time-in: ' + error.message;
        }
      });
      adjInTd.appendChild(adjInInput);
      // Adj. Out editable
      const adjOutTd = document.createElement('td');
      const adjOutInput = document.createElement('input');
      adjOutInput.type = 'datetime-local';
      adjOutInput.value = shift.adjTimeOut
        ? formatDateTimeLocal(shift.adjTimeOut)
        : '';
      adjOutInput.addEventListener('change', async () => {
        const val = adjOutInput.value;
        try {
          await updateDoc(doc(db, 'shifts', shift.id), {
            adjTimeOut: val ? Timestamp.fromDate(new Date(val)) : null,
          });
          adminMessages.textContent = 'Adjusted time-out updated.';
          await loadEmployeeDetail(uid);
        } catch (error) {
          adminMessages.textContent =
            'Error updating adjusted time-out: ' + error.message;
        }
      });
      adjOutTd.appendChild(adjOutInput);
      // Append cells to row
      [
        shift.date,
        dayOfWeek(dateObj),
        formatTime(shift.timeIn),
      ].forEach((val) => {
        const td = document.createElement('td');
        td.textContent = val;
        row.appendChild(td);
      });
      row.appendChild(adjInTd);
      // timeOut cell
      const timeOutCell = document.createElement('td');
      timeOutCell.textContent = formatTime(shift.timeOut);
      row.appendChild(timeOutCell);
      row.appendChild(adjOutTd);
      // hours
      const hoursTd = document.createElement('td');
      hoursTd.textContent = hours.toFixed(2);
      row.appendChild(hoursTd);
      // pay
      const payTd = document.createElement('td');
      payTd.textContent = pay.toFixed(2);
      row.appendChild(payTd);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    // Summary row (current pay period if set)
    const summaryDiv = document.createElement('p');
    if (payPeriodStartDate) {
      const { periodStart, periodEnd } = computeCurrentPeriod();
      let periodHours = 0;
      let periodPay = 0;
      shifts.forEach((shift) => {
        const date = new Date(shift.date);
        if (date >= periodStart && date <= periodEnd) {
          const h = calculateHours(
            shift.adjTimeIn || shift.timeIn,
            shift.adjTimeOut || shift.timeOut
          );
          periodHours += h;
          periodPay += h * (empData.hourlyRate || 0);
        }
      });
      summaryDiv.textContent = `Current Pay Period (${formatDateISO(
        periodStart
      )} – ${formatDateISO(periodEnd)}): Total Hours = ${periodHours.toFixed(
        2
      )}, Total Pay = ${periodPay.toFixed(2)}`;
    } else {
      summaryDiv.textContent = `Total Hours: ${totalHours.toFixed(
        2
      )}, Total Pay: ${totalPay.toFixed(2)}`;
    }
    employeeTableContainer.appendChild(table);
    employeeTableContainer.appendChild(summaryDiv);
    // Show export button
    exportCsvBtn.style.display = 'inline-block';
    // Attach export CSV function
    exportCsvBtn.onclick = () => {
      exportTableToCSV(uid, empData, shifts);
    };
  } catch (error) {
    console.error('Error loading employee detail:', error);
    employeeInfo.textContent = 'Error loading employee detail.';
  }
}

// Compute current pay period boundaries
function computeCurrentPeriod() {
  const today = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((today - payPeriodStartDate) / msPerDay);
  const periodIndex = Math.floor(diffDays / 14);
  const periodStart = new Date(
    payPeriodStartDate.getTime() + periodIndex * 14 * msPerDay
  );
  const periodEnd = new Date(periodStart.getTime() + 13 * msPerDay);
  return { periodStart, periodEnd };
}

// Format Firebase timestamp or ISO string into datetime-local value (YYYY-MM-DDTHH:MM)
function formatDateTimeLocal(ts) {
  let d;
  if (typeof ts === 'string') d = new Date(ts);
  else if (ts.toDate) d = ts.toDate();
  else d = new Date(ts);
  const iso = d.toISOString();
  return iso.slice(0, 16);
}

// Export current table to CSV
function exportTableToCSV(uid, empData, shifts) {
  // Build CSV string
  const headers = [
    'Date',
    'Day',
    'Time In',
    'Adj. In',
    'Time Out',
    'Adj. Out',
    'Hours',
    'Pay',
  ];
  let csvContent = '';
  csvContent += headers.join(',') + '\n';
  shifts.forEach((shift) => {
    const dateObj = new Date(shift.date);
    const hours = calculateHours(
      shift.adjTimeIn || shift.timeIn,
      shift.adjTimeOut || shift.timeOut
    );
    const pay = hours * (empData.hourlyRate || 0);
    const row = [
      shift.date,
      dayOfWeek(dateObj),
      formatTime(shift.timeIn),
      formatTime(shift.adjTimeIn),
      formatTime(shift.timeOut),
      formatTime(shift.adjTimeOut),
      hours.toFixed(2),
      pay.toFixed(2),
    ];
    csvContent += row.join(',') + '\n';
  });
  // Add summary line
  let summaryHours = 0;
  let summaryPay = 0;
  shifts.forEach((shift) => {
    const h = calculateHours(
      shift.adjTimeIn || shift.timeIn,
      shift.adjTimeOut || shift.timeOut
    );
    summaryHours += h;
    summaryPay += h * (empData.hourlyRate || 0);
  });
  csvContent += `Totals,,,,,,${summaryHours.toFixed(2)},${summaryPay.toFixed(2)}\n`;
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${empData.username || empData.email}-shifts.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Logout functionality
logoutBtn?.addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = 'index.html';
});

// Auth state observer for admin
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }
  currentUser = user;
  // Verify role
  const userDocRef = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userDocRef);
  if (!userSnap.exists()) {
    alert('User record missing.');
    return;
  }
  const userData = userSnap.data();
  if (userData.role !== 'admin') {
    window.location.href = 'employee.html';
    return;
  }
  // Load settings and employees list
  await loadSettings();
  await loadEmployees();
});