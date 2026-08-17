/* ==========================================================================
   SATA Split - Mobile Native App JavaScript Logic (v3.0.0)
   ========================================================================== */

class SataSplitApp {
  constructor() {
    window.app = this;
    
    this.activeTab = "expenses";
    this.currentUser = localStorage.getItem("fairshare_my_name") || "Ban";
    this.activeGroup = null;
    this.unsubscribeListener = null;

    this.init();
  }

  async init() {
    // 1. Load active group from local storage or default fallback
    const savedGroupId = localStorage.getItem("fairshare_last_active_group") || "default-group";
    this.loadGroup(savedGroupId);

    // 2. Setup DOM event listeners
    this.bindEvents();

    // 3. Initialize theme
    if (localStorage.getItem("fairshare_theme") === "light") {
      document.body.classList.add("light-theme");
      const btn = document.getElementById("btn-theme-toggle");
      if (btn) btn.textContent = "☀️";
    }

    // 4. Non-blocking Firebase real-time sync attempt
    this.initFirebase(savedGroupId);
  }

  // --- Safe Local Data Engine (Offline-First) ---

  getDefaultGroup(id = "default-group") {
    return {
      id: id,
      name: "Apartment Share",
      currency: "$",
      members: ["Ban", "ED", "Juin", "Bin", "Dennis", "Yan"],
      expenses: [],
      settlements: [],
      notes: [],
      activity: [
        { id: "act-1", text: "Group created", time: Date.now() }
      ],
      bankDetails: {
        "Ban": { fullName: "Ban Lim", bankName: "Maybank", accountNumber: "1642234455" },
        "ED": { fullName: "ED Tan", bankName: "CIMB", accountNumber: "7065543210" },
        "Juin": { fullName: "Juin", bankName: "", accountNumber: "" },
        "Bin": { fullName: "Bin", bankName: "", accountNumber: "" },
        "Dennis": { fullName: "Dennis", bankName: "", accountNumber: "" },
        "Yan": { fullName: "Yan", bankName: "", accountNumber: "" }
      },
      updatedAt: Date.now()
    };
  }

  normalizeGroup(group) {
    if (!group) return group;

    if (group.members && !Array.isArray(group.members)) {
      group.members = Object.values(group.members);
    } else {
      group.members = group.members || ["Ban"];
    }

    if (group.expenses) {
      if (!Array.isArray(group.expenses)) {
        group.expenses = Object.values(group.expenses);
      }
    } else {
      group.expenses = [];
    }

    if (group.settlements) {
      if (!Array.isArray(group.settlements)) {
        group.settlements = Object.values(group.settlements);
      }
    } else {
      group.settlements = [];
    }

    if (group.notes) {
      if (!Array.isArray(group.notes)) {
        group.notes = Object.values(group.notes);
      }
    } else {
      group.notes = [];
    }

    if (group.activity) {
      if (!Array.isArray(group.activity)) {
        group.activity = Object.values(group.activity);
      }
    } else {
      group.activity = [];
    }

    return group;
  }

  loadGroup(groupId) {
    let group = null;
    const rawLocal = localStorage.getItem(`fairshare_group_${groupId}`);
    if (rawLocal) {
      try { group = JSON.parse(rawLocal); } catch(e) {}
    }
    
    if (!group) {
      group = this.getDefaultGroup(groupId);
      localStorage.setItem(`fairshare_group_${groupId}`, JSON.stringify(group));
    }

    this.activeGroup = this.normalizeGroup(group);
    localStorage.setItem("fairshare_last_active_group", groupId);

    // Ensure currentUser is in members
    if (!this.activeGroup.members.includes(this.currentUser)) {
      this.currentUser = this.activeGroup.members[0] || "Ban";
      localStorage.setItem("fairshare_my_name", this.currentUser);
    }

    this.updateControls();
    this.renderDashboard();
  }

  saveGroupLocally() {
    if (!this.activeGroup) return;
    this.activeGroup.updatedAt = Date.now();
    localStorage.setItem(`fairshare_group_${this.activeGroup.id}`, JSON.stringify(this.activeGroup));
    this.renderDashboard();

    // Async cloud sync if Firebase Compat is available
    if (window.firebase && window.firebase.apps && window.firebase.apps.length > 0) {
      // 1. Cloud Firestore Sync
      try {
        const db = window.firebase.firestore();
        db.collection("groups").doc(this.activeGroup.id).set(this.activeGroup, { merge: true })
          .then(() => { this.updateSyncBadge(true); })
          .catch((err) => { console.error("Firestore Save Error:", err); });
      } catch(e) {}

      // 2. Realtime Database Sync
      try {
        if (window.firebase.database) {
          const rtdb = window.firebase.database();
          rtdb.ref("groups/" + this.activeGroup.id).set(this.activeGroup)
            .then(() => { this.updateSyncBadge(true); })
            .catch((err) => { console.error("Realtime Database Save Error:", err); });
        }
      } catch(e) {}
    }
  }

  updateSyncBadge(isCloud) {
    const badge = document.getElementById("sync-status-badge");
    if (!badge) return;
    if (isCloud) {
      badge.textContent = "Cloud ☁️";
      badge.style.background = "rgba(16, 185, 129, 0.2)";
      badge.style.color = "var(--success-color)";
      badge.style.borderColor = "rgba(16, 185, 129, 0.3)";
    } else {
      badge.textContent = "Local";
      badge.style.background = "rgba(245, 158, 11, 0.2)";
      badge.style.color = "var(--warning-color)";
    }
  }

  forceCloudRefresh() {
    this.showToast("Fetching latest data from Cloud... ☁️", "info");
    if (!this.activeGroup) return;
    const groupId = this.activeGroup.id;

    if (window.firebase && window.firebase.apps && window.firebase.apps.length > 0) {
      try {
        const db = window.firebase.firestore();
        db.collection("groups").doc(groupId).get().then((docSnap) => {
          if (docSnap.exists) {
            const remoteGroup = docSnap.data();
            this.activeGroup = this.normalizeGroup(remoteGroup);
            localStorage.setItem(`fairshare_group_${groupId}`, JSON.stringify(this.activeGroup));
            this.updateControls();
            this.renderDashboard();
            this.updateSyncBadge(true);
            this.showToast(`Synced ${this.activeGroup.expenses.length} expenses from Cloud! 🎉`, "success");
          }
        }).catch((err) => {
          console.error("Manual Firestore fetch error:", err);
        });

        if (window.firebase.database) {
          const rtdb = window.firebase.database();
          rtdb.ref("groups/" + groupId).once("value").then((snapshot) => {
            if (snapshot.exists()) {
              const remoteGroup = snapshot.val();
              this.activeGroup = this.normalizeGroup(remoteGroup);
              localStorage.setItem(`fairshare_group_${groupId}`, JSON.stringify(this.activeGroup));
              this.updateControls();
              this.renderDashboard();
              this.updateSyncBadge(true);
            }
          });
        }
      } catch(e) {
        console.error("Force Cloud Refresh error:", e);
      }
    }
  }

  initFirebase(groupId) {
    const config = window.firebaseConfig || window.FIREBASE_CONFIG;
    if (!config || !window.firebase) {
      console.warn("Firebase configuration not found. Running in Local Mode.");
      this.updateSyncBadge(false);
      return;
    }
    try {
      if (!window.firebase.apps.length) {
        window.firebase.initializeApp(config);
      }
      
      // 1. Initialize Firestore
      try {
        const db = window.firebase.firestore();
        db.collection("groups").doc(groupId).get().then((docSnap) => {
          if (!docSnap.exists) {
            db.collection("groups").doc(groupId).set(this.activeGroup).catch(() => {});
          }
        }).catch(() => {});

        this.unsubscribeListener = db.collection("groups").doc(groupId).onSnapshot((snapshot) => {
          if (snapshot && snapshot.exists) {
            const remoteGroup = snapshot.data();
            if (remoteGroup && remoteGroup.members) {
              this.activeGroup = this.normalizeGroup(remoteGroup);
              localStorage.setItem(`fairshare_group_${groupId}`, JSON.stringify(this.activeGroup));
              this.updateControls();
              this.renderDashboard();
              this.updateSyncBadge(true);
            }
          }
        }, (err) => {
          console.warn("Firestore sync notice:", err.message);
        });
      } catch(e) {}

      // 2. Initialize Realtime Database Sync
      try {
        if (window.firebase.database) {
          const rtdb = window.firebase.database();
          rtdb.ref("groups/" + groupId).on("value", (snapshot) => {
            if (snapshot.exists()) {
              const remoteGroup = snapshot.val();
              if (remoteGroup && remoteGroup.members) {
                this.activeGroup = this.normalizeGroup(remoteGroup);
                localStorage.setItem(`fairshare_group_${groupId}`, JSON.stringify(this.activeGroup));
                this.updateControls();
                this.renderDashboard();
                this.updateSyncBadge(true);
              }
            } else {
              rtdb.ref("groups/" + groupId).set(this.activeGroup).catch(() => {});
            }
          }, (err) => {
            console.warn("Realtime Database sync notice:", err.message);
          });
        }
      } catch(e) {}

    } catch(e) {
      console.warn("Firebase initialization skipped, running in local mode.");
      this.updateSyncBadge(false);
    }
  }

  // --- UI Router & Event Binders ---

  switchTab(tabName) {
    this.activeTab = tabName;

    // Toggle tab views
    document.querySelectorAll(".tab-view").forEach(view => {
      view.classList.remove("active");
    });
    const targetView = document.getElementById(`view-${tabName}`);
    if (targetView) targetView.classList.add("active");

    // Toggle nav bar active states
    document.querySelectorAll(".nav-item").forEach(item => {
      if (item.getAttribute("data-tab") === tabName) item.classList.add("active");
      else item.classList.remove("active");
    });

    this.renderDashboard();
  }

  toggleTheme() {
    const isLight = document.body.classList.toggle("light-theme");
    localStorage.setItem("fairshare_theme", isLight ? "light" : "dark");
    const btn = document.getElementById("btn-theme-toggle");
    if (btn) btn.textContent = isLight ? "☀️" : "🌙";
  }

  updateControls() {
    if (!this.activeGroup) return;

    // Group select
    const groupSelect = document.getElementById("select-group");
    if (groupSelect) {
      groupSelect.innerHTML = `<option value="${this.activeGroup.id}">${this.activeGroup.name}</option>`;
    }

    // User select
    const userSelect = document.getElementById("select-user");
    if (userSelect) {
      userSelect.innerHTML = "";
      this.activeGroup.members.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m === this.currentUser ? `${m} (You)` : m;
        if (m === this.currentUser) opt.selected = true;
        userSelect.appendChild(opt);
      });
    }
  }

  bindEvents() {
    // User change
    const userSelect = document.getElementById("select-user");
    if (userSelect) {
      userSelect.addEventListener("change", (e) => {
        this.currentUser = e.target.value;
        localStorage.setItem("fairshare_my_name", e.target.value);
        this.updateControls();
        this.renderDashboard();
        this.showToast(`Switched active user to ${this.currentUser}`, "info");
      });
    }

    // Search and filter
    const searchInput = document.getElementById("input-search");
    if (searchInput) searchInput.addEventListener("input", () => this.renderDashboard());

    const catFilter = document.getElementById("select-category-filter");
    if (catFilter) catFilter.addEventListener("change", () => this.renderDashboard());

    // Expense Form Submit
    const formExpense = document.getElementById("form-expense");
    if (formExpense) {
      formExpense.addEventListener("submit", (e) => {
        e.preventDefault();
        this.saveExpenseForm();
      });
    }

    // Settlement Form Submit
    const formSettle = document.getElementById("form-settle");
    if (formSettle) {
      formSettle.addEventListener("submit", (e) => {
        e.preventDefault();
        this.saveSettlementForm();
      });
    }

    // Note Form Submit
    const formNote = document.getElementById("form-note");
    if (formNote) {
      formNote.addEventListener("submit", (e) => {
        e.preventDefault();
        this.saveNoteForm();
      });
    }

    // Group Settings Form Submit
    const formGroup = document.getElementById("form-group-settings");
    if (formGroup) {
      formGroup.addEventListener("submit", (e) => {
        e.preventDefault();
        this.saveGroupSettingsForm();
      });
    }

    // Onboarding Form Submit
    const formOnboarding = document.getElementById("form-onboarding");
    if (formOnboarding) {
      formOnboarding.addEventListener("submit", (e) => {
        e.preventDefault();
        this.saveOnboardingForm();
      });
    }
  }

  // --- Rendering Calculations & Views ---

  calculateBalances() {
    if (!this.activeGroup) return { balances: {}, totalSpend: 0 };

    const balances = {};
    this.activeGroup.members.forEach(m => balances[m] = 0);

    let totalSpend = 0;

    // Process Expenses
    (this.activeGroup.expenses || []).forEach(exp => {
      const amount = parseFloat(exp.amount) || 0;
      totalSpend += amount;

      if (balances[exp.paidBy] !== undefined) {
        balances[exp.paidBy] += amount;
      }

      const splitCount = this.activeGroup.members.length;
      if (splitCount > 0) {
        const perPerson = amount / splitCount;
        this.activeGroup.members.forEach(m => {
          if (balances[m] !== undefined) {
            balances[m] -= perPerson;
          }
        });
      }
    });

    // Process Settlements
    (this.activeGroup.settlements || []).forEach(s => {
      const amount = parseFloat(s.amount) || 0;
      if (balances[s.payer] !== undefined) balances[s.payer] += amount;
      if (balances[s.payee] !== undefined) balances[s.payee] -= amount;
    });

    return { balances, totalSpend };
  }

  renderDashboard() {
    if (!this.activeGroup) return;

    const { balances, totalSpend } = this.calculateBalances();
    const currency = this.activeGroup.currency || "$";

    // 1. Update Stat Cards
    const myBalance = balances[this.currentUser] || 0;
    document.getElementById("stat-total").textContent = `${currency}${totalSpend.toFixed(2)}`;
    
    const oweEl = document.getElementById("stat-owe");
    const owedEl = document.getElementById("stat-owed");
    if (myBalance < 0) {
      oweEl.textContent = `${currency}${Math.abs(myBalance).toFixed(2)}`;
      owedEl.textContent = `${currency}0.00`;
    } else {
      oweEl.textContent = `${currency}0.00`;
      owedEl.textContent = `${currency}${myBalance.toFixed(2)}`;
    }

    // 2. Render Active Tab Content
    if (this.activeTab === "expenses") {
      this.renderExpensesList(currency);
    } else if (this.activeTab === "balances") {
      this.renderBalancesView(balances, currency);
    } else if (this.activeTab === "activity") {
      this.renderActivityView();
    } else if (this.activeTab === "notes") {
      this.renderNotesView();
    } else if (this.activeTab === "manage") {
      this.renderManageView();
    }
  }

  renderExpensesList(currency) {
    const list = document.getElementById("expenses-list");
    if (!list) return;
    list.innerHTML = "";

    const expensesArray = Array.isArray(this.activeGroup?.expenses) 
      ? this.activeGroup.expenses 
      : (this.activeGroup?.expenses ? Object.values(this.activeGroup.expenses) : []);

    const query = (document.getElementById("input-search")?.value || "").toLowerCase().trim();
    const category = document.getElementById("select-category-filter")?.value || "all";

    const filtered = expensesArray.filter(exp => {
      if (!exp) return false;
      const desc = String(exp.description || "").toLowerCase();
      const payer = String(exp.paidBy || "").toLowerCase();
      const matchQuery = !query || desc.includes(query) || payer.includes(query);
      const matchCat = category === "all" || exp.category === category;
      return matchQuery && matchCat;
    });

    if (filtered.length === 0) {
      list.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No expenses found. Tap + to add one!</div>';
      return;
    }

    filtered.slice().reverse().forEach(exp => {
      const card = document.createElement("div");
      card.className = "expense-card";
      
      const iconMap = { meals: "🍔", groceries: "🛒", transport: "🚕", entertainment: "🍿", utilities: "⚡", other: "📦" };
      const icon = iconMap[exp.category] || "🧾";
      const amount = parseFloat(exp.amount || 0);

      card.innerHTML = `
        <div class="card-left">
          <div class="card-icon">${icon}</div>
          <div class="card-details">
            <div class="card-title">${exp.description || "Expense"}</div>
            <div class="card-meta">Paid by <strong>${exp.paidBy || "Member"}</strong></div>
          </div>
        </div>
        <div class="card-right" style="display: flex; align-items: center; gap: 0.5rem;">
          <div style="text-align: right;">
            <div class="card-amount">${currency}${amount.toFixed(2)}</div>
            <div class="card-split-tag">Split Equally</div>
          </div>
          <button type="button" class="icon-btn" title="Delete Expense" style="font-size: 0.9rem; padding: 0.3rem; border-radius: 8px; color: var(--danger-color);" onclick="event.stopPropagation(); if(window.app){ window.app.deleteExpense('${exp.id}'); }">🗑️</button>
        </div>
      `;

      card.addEventListener("click", () => this.openExpenseModal(exp));
      list.appendChild(card);
    });
  }

  renderBalancesView(balances, currency) {
    const list = document.getElementById("balances-list");
    if (!list) return;
    list.innerHTML = "";

    Object.keys(balances).forEach(member => {
      const val = balances[member];
      const card = document.createElement("div");
      card.className = "balance-card";
      const isPositive = val >= 0;
      
      card.innerHTML = `
        <div class="balance-name">${member}</div>
        <div class="balance-val ${isPositive ? 'positive' : 'negative'}">
          ${isPositive ? '+' : ''}${currency}${val.toFixed(2)}
        </div>
      `;
      list.appendChild(card);
    });

    // Simplify Debts Algorithm
    this.renderDebtsList(balances, currency);

    // Settlement History
    this.renderSettlementsList(currency);
  }

  renderDebtsList(balances, currency) {
    const debtsList = document.getElementById("debts-list");
    if (!debtsList) return;
    debtsList.innerHTML = "";

    const debtors = [];
    const creditors = [];

    Object.keys(balances).forEach(member => {
      const amount = balances[member];
      if (amount < -0.01) debtors.push({ member, amount: -amount });
      else if (amount > 0.01) creditors.push({ member, amount });
    });

    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    let i = 0, j = 0;
    const transactions = [];

    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i];
      const creditor = creditors[j];
      const settledAmount = Math.min(debtor.amount, creditor.amount);

      transactions.push({
        payer: debtor.member,
        payee: creditor.member,
        amount: settledAmount
      });

      debtor.amount -= settledAmount;
      creditor.amount -= settledAmount;

      if (debtor.amount < 0.01) i++;
      if (creditor.amount < 0.01) j++;
    }

    if (transactions.length === 0) {
      debtsList.innerHTML = '<div style="text-align: center; color: var(--success-color); padding: 1rem; font-weight: 600;">Everyone is all settled up! 🎉</div>';
      return;
    }

    transactions.forEach(t => {
      const card = document.createElement("div");
      card.className = "settle-card";
      card.innerHTML = `
        <div class="settle-text">
          <strong>${t.payer}</strong> owes <strong>${t.payee}</strong> <span style="color: var(--warning-color); font-weight: 700;">${currency}${t.amount.toFixed(2)}</span>
        </div>
        <button class="settle-btn" onclick="if(window.app) window.app.openSettleModal('${t.payer}', '${t.payee}', ${t.amount})">Settle Up</button>
      `;
      debtsList.appendChild(card);
    });
  }

  renderSettlementsList(currency) {
    const list = document.getElementById("settlements-list");
    if (!list) return;
    list.innerHTML = "";

    const settlements = this.activeGroup.settlements || [];
    if (settlements.length === 0) {
      list.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 1rem;">No settlement payments recorded yet.</div>';
      return;
    }

    settlements.slice().reverse().forEach(s => {
      const card = document.createElement("div");
      card.className = "activity-item";
      card.innerHTML = `
        <div>
          <strong>${s.payer}</strong> paid <strong>${s.payee}</strong>
        </div>
        <div style="font-weight: 700; color: var(--success-color);">${currency}${parseFloat(s.amount).toFixed(2)}</div>
      `;
      list.appendChild(card);
    });
  }

  renderActivityView() {
    const list = document.getElementById("activity-list");
    if (!list) return;
    list.innerHTML = "";

    const activities = this.activeGroup.activity || [];
    if (activities.length === 0) {
      list.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No recent group activity.</div>';
      return;
    }

    activities.slice().reverse().forEach(act => {
      const item = document.createElement("div");
      item.className = "activity-item";
      const timeStr = act.time ? new Date(act.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      item.innerHTML = `
        <div>${act.text}</div>
        <div class="activity-time">${timeStr}</div>
      `;
      list.appendChild(item);
    });
  }

  renderNotesView() {
    const list = document.getElementById("notes-list");
    if (!list) return;
    list.innerHTML = "";

    const notes = this.activeGroup.notes || [];
    if (notes.length === 0) {
      list.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No notes yet. Post a travel note above!</div>';
      return;
    }

    notes.slice().reverse().forEach(note => {
      const card = document.createElement("div");
      card.className = "activity-item";
      card.innerHTML = `
        <div>
          <div style="font-weight: 600; color: var(--text-primary);">${note.text}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem;">Posted by ${note.author}</div>
        </div>
      `;
      list.appendChild(card);
    });
  }

  renderManageView() {
    const nameInput = document.getElementById("input-group-name");
    const currencyInput = document.getElementById("input-group-currency");
    if (nameInput) nameInput.value = this.activeGroup.name;
    if (currencyInput) currencyInput.value = this.activeGroup.currency;

    const list = document.getElementById("manage-members-list");
    if (!list) return;
    list.innerHTML = "";

    this.activeGroup.members.forEach(m => {
      const card = document.createElement("div");
      card.className = "balance-card";
      card.style.flexDirection = "column";
      card.style.alignItems = "stretch";
      card.style.gap = "0.5rem";

      const bank = (this.activeGroup.bankDetails && this.activeGroup.bankDetails[m]) || {};
      const hasQr = !!bank.qrCodeUrl;
      const bankInfoText = bank.bankName 
        ? `${bank.bankName} - ${bank.accountNumber}${bank.fullName ? ` (${bank.fullName})` : ''}`
        : 'No bank details saved';

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong style="font-size: 0.95rem; color: var(--text-primary);">${m}</strong>
            ${hasQr ? '<span style="font-size: 0.65rem; background: rgba(16, 185, 129, 0.2); color: var(--success-color); border: 1px solid rgba(16, 185, 129, 0.3); padding: 0.1rem 0.4rem; border-radius: 99px; margin-left: 0.4rem; font-weight: 700;">📷 QR Ready</span>' : ''}
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.15rem;">
              ${bankInfoText}
            </div>
          </div>
          <button type="button" class="btn-submit" style="padding: 0.35rem 0.75rem; font-size: 0.75rem; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color);" onclick="if(window.app) window.app.openMemberEditModal('${m}')">Edit Bank & QR ✏️</button>
        </div>
      `;
      list.appendChild(card);
    });
  }

  // --- Modal Controllers ---

  openExpenseModal(expenseToEdit = null) {
    const dialog = document.getElementById("modal-expense");
    const form = document.getElementById("form-expense");
    if (!dialog || !form) return;

    form.reset();
    document.getElementById("expense-modal-title").textContent = expenseToEdit ? "Edit Expense" : "Add New Expense";

    // Populate PaidBy Select
    const paidBySelect = document.getElementById("input-expense-paidby");
    paidBySelect.innerHTML = "";
    this.activeGroup.members.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      if (m === this.currentUser) opt.selected = true;
      paidBySelect.appendChild(opt);
    });

    const deleteBtn = document.getElementById("btn-delete-expense");

    if (expenseToEdit) {
      document.getElementById("input-expense-id").value = expenseToEdit.id;
      document.getElementById("input-expense-desc").value = expenseToEdit.description;
      document.getElementById("input-expense-amount").value = expenseToEdit.amount;
      document.getElementById("input-expense-paidby").value = expenseToEdit.paidBy;
      document.getElementById("input-expense-category").value = expenseToEdit.category || "meals";
      if (deleteBtn) deleteBtn.style.display = "block";
    } else {
      document.getElementById("input-expense-id").value = "";
      if (deleteBtn) deleteBtn.style.display = "none";
    }

    dialog.showModal();
  }

  deleteExpense(expenseId) {
    if (!this.activeGroup || !expenseId) return;
    
    const expensesArray = Array.isArray(this.activeGroup.expenses) 
      ? this.activeGroup.expenses 
      : Object.values(this.activeGroup.expenses || {});

    const exp = expensesArray.find(e => e.id === expenseId);
    const desc = exp ? exp.description : "Expense";

    if (confirm(`Are you sure you want to delete "${desc}"?`)) {
      this.activeGroup.expenses = expensesArray.filter(e => e.id !== expenseId);
      this.logActivity(`${this.currentUser} deleted expense "${desc}"`);
      
      this.saveGroupLocally();
      
      const modal = document.getElementById("modal-expense");
      if (modal) modal.close();
      
      this.showToast(`Deleted expense "${desc}" 🗑️`, "success");
    }
  }

  saveExpenseForm() {
    try {
      if (!this.activeGroup) {
        this.showToast("No active group loaded!", "error");
        return;
      }

      this.activeGroup.expenses = this.activeGroup.expenses || [];
      
      const id = document.getElementById("input-expense-id")?.value || "";
      const description = (document.getElementById("input-expense-desc")?.value || "").trim();
      const amountVal = document.getElementById("input-expense-amount")?.value;
      const amount = parseFloat(amountVal);
      const paidBy = document.getElementById("input-expense-paidby")?.value || this.currentUser || (this.activeGroup.members[0] || "Ban");
      const category = document.getElementById("input-expense-category")?.value || "meals";

      if (!description) {
        this.showToast("Please enter an expense description!", "error");
        return;
      }
      if (isNaN(amount) || amount <= 0) {
        this.showToast("Please enter a valid expense amount!", "error");
        return;
      }

      if (id) {
        // Edit existing expense
        const expIndex = this.activeGroup.expenses.findIndex(e => e.id === id);
        if (expIndex !== -1) {
          this.activeGroup.expenses[expIndex] = { 
            ...this.activeGroup.expenses[expIndex], 
            description, 
            amount, 
            paidBy, 
            category 
          };
        } else {
          this.activeGroup.expenses.push({
            id: "exp-" + Date.now(),
            description,
            amount,
            paidBy,
            category,
            date: new Date().toISOString().split("T")[0]
          });
        }
      } else {
        // Add new expense
        const newExp = {
          id: "exp-" + Date.now(),
          description,
          amount,
          paidBy,
          category,
          date: new Date().toISOString().split("T")[0]
        };
        this.activeGroup.expenses.push(newExp);
        const currency = this.activeGroup.currency || "$";
        this.logActivity(`${paidBy} added expense "${description}" for ${currency}${amount.toFixed(2)}`);
      }

      this.saveGroupLocally();
      
      const modal = document.getElementById("modal-expense");
      if (modal) modal.close();
      
      this.showToast("Expense saved successfully! 🎉", "success");
    } catch(err) {
      console.error("Save Expense Error:", err);
      this.showToast("Failed to save expense. Please try again.", "error");
    }
  }

  openSettleModal(payer, payee, amount) {
    const dialog = document.getElementById("modal-settle");
    if (!dialog) return;

    const payerSelect = document.getElementById("input-settle-payer");
    const payeeSelect = document.getElementById("input-settle-payee");
    payerSelect.innerHTML = "";
    payeeSelect.innerHTML = "";

    this.activeGroup.members.forEach(m => {
      const opt1 = document.createElement("option");
      opt1.value = m; opt1.textContent = m;
      if (m === payer) opt1.selected = true;
      payerSelect.appendChild(opt1);

      const opt2 = document.createElement("option");
      opt2.value = m; opt2.textContent = m;
      if (m === payee) opt2.selected = true;
      payeeSelect.appendChild(opt2);
    });

    document.getElementById("input-settle-amount").value = amount ? amount.toFixed(2) : "";
    
    payeeSelect.onchange = () => this.updateSettlePayeeInfo();
    this.updateSettlePayeeInfo();

    dialog.showModal();
  }

  updateSettlePayeeInfo() {
    const payeeSelect = document.getElementById("input-settle-payee");
    if (!payeeSelect || !this.activeGroup) return;
    const payee = payeeSelect.value;
    const bank = (this.activeGroup.bankDetails && this.activeGroup.bankDetails[payee]) || {};

    const payeeNameEl = document.getElementById("settle-payee-name");
    const payeeInfoEl = document.getElementById("settle-payee-bank-info");
    const payeeQrContainer = document.getElementById("settle-payee-qr-preview");
    const payeeQrImg = document.getElementById("img-settle-payee-qr");

    if (payeeNameEl) payeeNameEl.textContent = payee;

    if (payeeInfoEl) {
      if (bank.bankName || bank.accountNumber) {
        let html = `<strong>Bank:</strong> ${bank.bankName || 'Not specified'}<br>`;
        html += `<strong>Account:</strong> ${bank.accountNumber || 'Not specified'} `;
        if (bank.accountNumber) {
          html += `<button type="button" style="background: none; border: none; color: var(--primary-color); cursor: pointer; text-decoration: underline; font-size: 0.75rem;" onclick="navigator.clipboard.writeText('${bank.accountNumber}'); if(window.app) window.app.showToast('Account number copied! 📋', 'info');">📋 Copy</button>`;
        }
        if (bank.fullName) html += `<br><strong>Name:</strong> ${bank.fullName}`;
        payeeInfoEl.innerHTML = html;
      } else {
        payeeInfoEl.innerHTML = `<em>No bank account saved for ${payee}. Edit details in Manage tab.</em>`;
      }
    }

    if (payeeQrContainer && payeeQrImg) {
      if (bank.qrCodeUrl) {
        payeeQrImg.src = bank.qrCodeUrl;
        payeeQrContainer.style.display = "block";
      } else {
        payeeQrContainer.style.display = "none";
      }
    }
  }

  openMemberEditModal(memberName) {
    const dialog = document.getElementById("modal-member-edit");
    if (!dialog) return;

    const bank = (this.activeGroup.bankDetails && this.activeGroup.bankDetails[memberName]) || {};

    document.getElementById("input-member-edit-name").value = memberName;
    document.getElementById("input-member-edit-nickname").value = memberName;
    document.getElementById("input-member-edit-fullname").value = bank.fullName || "";
    document.getElementById("input-member-edit-bankname").value = bank.bankName || "";
    document.getElementById("input-member-edit-accountno").value = bank.accountNumber || "";
    document.getElementById("input-member-edit-qrdata").value = bank.qrCodeUrl || "";
    document.getElementById("input-member-edit-qrfile").value = "";

    const previewBox = document.getElementById("member-qr-preview-box");
    const previewImg = document.getElementById("img-member-qr-preview");

    if (bank.qrCodeUrl) {
      previewImg.src = bank.qrCodeUrl;
      previewBox.style.display = "block";
    } else {
      previewBox.style.display = "none";
    }

    dialog.showModal();
  }

  onQrFileSelected(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        const maxDim = 500;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

        document.getElementById("input-member-edit-qrdata").value = dataUrl;
        const previewBox = document.getElementById("member-qr-preview-box");
        const previewImg = document.getElementById("img-member-qr-preview");
        previewImg.src = dataUrl;
        previewBox.style.display = "block";
        this.showToast("QR code image loaded & compressed! 📷", "info");
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  removeMemberQrCode() {
    document.getElementById("input-member-edit-qrdata").value = "";
    document.getElementById("input-member-edit-qrfile").value = "";
    document.getElementById("member-qr-preview-box").style.display = "none";
    this.showToast("QR code removed. Save to apply.", "info");
  }

  saveMemberEditForm() {
    const memberName = document.getElementById("input-member-edit-name").value;
    if (!memberName || !this.activeGroup) return;

    const fullName = (document.getElementById("input-member-edit-fullname").value || "").trim();
    const bankName = (document.getElementById("input-member-edit-bankname").value || "").trim();
    const accountNumber = (document.getElementById("input-member-edit-accountno").value || "").trim();
    const qrCodeUrl = document.getElementById("input-member-edit-qrdata").value || "";

    this.activeGroup.bankDetails = this.activeGroup.bankDetails || {};
    this.activeGroup.bankDetails[memberName] = {
      fullName,
      bankName,
      accountNumber,
      qrCodeUrl
    };

    this.saveGroupLocally();
    const modal = document.getElementById("modal-member-edit");
    if (modal) modal.close();
    this.showToast(`Saved bank & QR details for ${memberName}! 💳✨`, "success");
  }

  saveSettlementForm() {
    const payer = document.getElementById("input-settle-payer").value;
    const payee = document.getElementById("input-settle-payee").value;
    const amount = parseFloat(document.getElementById("input-settle-amount").value);

    if (payer === payee) {
      this.showToast("Payer and payee cannot be the same person!", "error");
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      this.showToast("Please enter a valid settlement amount!", "error");
      return;
    }

    const newSettle = {
      id: "settle-" + Date.now(),
      payer,
      payee,
      amount,
      date: new Date().toISOString().split("T")[0]
    };

    this.activeGroup.settlements = this.activeGroup.settlements || [];
    this.activeGroup.settlements.push(newSettle);
    this.logActivity(`${payer} paid ${payee} $${amount.toFixed(2)} in settlement`);

    this.saveGroupLocally();
    document.getElementById("modal-settle").close();
    this.showToast("Settlement recorded!", "success");
  }

  saveNoteForm() {
    const input = document.getElementById("input-note-text");
    const text = input.value.trim();
    if (!text) return;

    this.activeGroup.notes = this.activeGroup.notes || [];
    this.activeGroup.notes.push({
      id: "note-" + Date.now(),
      text,
      author: this.currentUser,
      date: Date.now()
    });

    input.value = "";
    this.saveGroupLocally();
    this.showToast("Note posted!", "success");
  }

  saveGroupSettingsForm() {
    const name = document.getElementById("input-group-name").value.trim();
    const currency = document.getElementById("input-group-currency").value.trim();
    if (!name || !currency) return;

    this.activeGroup.name = name;
    this.activeGroup.currency = currency;
    this.saveGroupLocally();
    this.updateControls();
    this.showToast("Group settings saved!", "success");
  }

  openOnboarding() {
    const dialog = document.getElementById("modal-onboarding");
    if (!dialog) return;

    const select = document.getElementById("select-onboarding-member");
    select.innerHTML = '<option value="">-- Select Member Name --</option>';
    this.activeGroup.members.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      select.appendChild(opt);
    });

    document.getElementById("input-onboarding-name").value = "";
    dialog.showModal();
  }

  saveOnboardingForm() {
    const selectVal = document.getElementById("select-onboarding-member").value;
    const inputVal = document.getElementById("input-onboarding-name").value.trim();

    let chosen = "";
    if (inputVal) {
      chosen = inputVal.charAt(0).toUpperCase() + inputVal.slice(1);
      if (!this.activeGroup.members.includes(chosen)) {
        this.activeGroup.members.push(chosen);
        this.logActivity(`${chosen} joined the group as a new member`);
      }
    } else if (selectVal) {
      chosen = selectVal;
    } else {
      this.showToast("Please select a name or enter a nickname!", "error");
      return;
    }

    this.currentUser = chosen;
    localStorage.setItem("fairshare_my_name", chosen);
    this.saveGroupLocally();
    this.updateControls();
    document.getElementById("modal-onboarding").close();
    this.showToast(`Welcome, ${chosen}!`, "success");
  }

  logActivity(text) {
    this.activeGroup.activity = this.activeGroup.activity || [];
    this.activeGroup.activity.push({
      id: "act-" + Date.now(),
      text,
      time: Date.now()
    });
  }

  showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = "toast";
    if (type === "error") toast.style.borderColor = "var(--danger-color)";
    else if (type === "success") toast.style.borderColor = "var(--success-color)";
    
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }
}

// ReadyState Safe Application Starter
function startApp() {
  if (!window.app) {
    window.app = new SataSplitApp();
    console.log("SATA Split Native Mobile App (v3.0.0) initialized successfully.");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp);
} else {
  startApp();
}
