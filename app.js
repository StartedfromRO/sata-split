/**
 * SATA Split - Core Application Logic
 * Implements dual storage adapters (LocalStorage/Firestore),
 * debt simplification algorithm, and real-time UI synchronization.
 */

// --- Firebase Modular SDK Imports (via CDN) ---
let firebaseApp = null;
let firestoreDb = null;
let isFirebaseEnabled = false;

// Dynamic imports of Firebase libraries
async function initFirebase(config) {
  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js");
    const { getFirestore } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
    
    firebaseApp = initializeApp(config);
    firestoreDb = getFirestore(firebaseApp);
    isFirebaseEnabled = true;
    console.log("Firebase initialized successfully.");
    return true;
  } catch (error) {
    console.error("Failed to initialize Firebase:", error);
    isFirebaseEnabled = false;
    return false;
  }
}

// Helper to generate unique IDs
function generateUUID() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// --- Storage Adapters ---

class LocalStorageAdapter {
  constructor() {
    this.storageKey = "fairshare_groups_v1";
    // Initialize default group if storage is empty
    if (!localStorage.getItem(this.storageKey)) {
      const defaultGroup = {
        id: "default-group",
        name: "Apartment Share",
        currency: "$",
        members: ["Ban", "ED", "Juin", "Bin", "Dennis", "Yan"],
        expenses: [],
        settlements: [],
        bankDetails: {
          "Ban": { fullName: "Ban Lim", bankName: "Maybank", accountNumber: "1642234455", qrCode: "" },
          "ED": { fullName: "ED Tan", bankName: "CIMB", accountNumber: "7065543210", qrCode: "" },
          "Juin": { fullName: "Juin", bankName: "", accountNumber: "", qrCode: "" },
          "Bin": { fullName: "Bin", bankName: "", accountNumber: "", qrCode: "" },
          "Dennis": { fullName: "Dennis", bankName: "", accountNumber: "", qrCode: "" },
          "Yan": { fullName: "Yan", bankName: "", accountNumber: "", qrCode: "" }
        },
        updatedAt: Date.now()
      };
      localStorage.setItem(this.storageKey, JSON.stringify({ "default-group": defaultGroup }));
    }
  }

  async getGroups() {
    return JSON.parse(localStorage.getItem(this.storageKey) || "{}");
  }

  async getGroup(id) {
    const groups = await this.getGroups();
    return groups[id] || null;
  }

  async saveGroup(group) {
    const groups = await this.getGroups();
    group.updatedAt = Date.now();
    groups[group.id] = group;
    localStorage.setItem(this.storageKey, JSON.stringify(groups));
  }

  async deleteGroup(id) {
    const groups = await this.getGroups();
    delete groups[id];
    localStorage.setItem(this.storageKey, JSON.stringify(groups));
  }

  async createGroup(name, currency = "$", initialMembers = ["Ban", "ED", "Juin", "Bin", "Dennis", "Yan"]) {
    const id = "group_" + Math.random().toString(36).substring(2, 11);
    const bankDetails = {};
    initialMembers.forEach(m => {
      bankDetails[m] = {
        bankName: "",
        accountNumber: "",
        fullName: m === "Ban" ? "Ban Lim" : m === "ED" ? "ED Tan" : m,
        qrCode: ""
      };
    });
    const newGroup = {
      id,
      name,
      currency,
      members: initialMembers,
      expenses: [],
      settlements: [],
      bankDetails,
      updatedAt: Date.now()
    };
    await this.saveGroup(newGroup);
    return newGroup;
  }

  listenToGroup(id, callback) {
    // Local storage has no real-time push, so we trigger callbacks on updates manually.
    // We register a simple poll or just let normal actions trigger a reload.
    // For local storage, we also listen to the window storage event (for multiple local tabs).
    const storageHandler = (e) => {
      if (e.key === this.storageKey) {
        this.getGroup(id).then(callback);
      }
    };
    window.addEventListener("storage", storageHandler);
    
    // Initial fetch
    this.getGroup(id).then(callback);
    
    return () => window.removeEventListener("storage", storageHandler);
  }
}

class FirestoreAdapter {
  constructor(db) {
    this.db = db;
    this.collectionName = "fairshare_groups";
  }

  async getGroups() {
    // Note: In Firestore mode, we don't list all public groups for privacy.
    // Instead we just keep track of recently accessed group IDs in localStorage.
    const recentIds = JSON.parse(localStorage.getItem("fairshare_recent_groups") || "[]");
    const groups = {};
    
    const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
    
    for (const id of recentIds) {
      try {
        const docRef = doc(this.db, this.collectionName, id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          groups[id] = docSnap.data();
        }
      } catch (err) {
        console.error(`Error loading group ${id} from Firestore:`, err);
      }
    }
    return groups;
  }

  async getGroup(id) {
    const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
    const docRef = doc(this.db, this.collectionName, id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      this.trackRecentGroup(id);
      return docSnap.data();
    }
    return null;
  }

  async saveGroup(group) {
    const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
    group.updatedAt = Date.now();
    const docRef = doc(this.db, this.collectionName, group.id);
    await setDoc(docRef, group);
    this.trackRecentGroup(group.id);
  }

  async deleteGroup(id) {
    const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
    const docRef = doc(this.db, this.collectionName, id);
    await deleteDoc(docRef);
    
    // Also remove from recent groups list in localStorage
    const recentIds = JSON.parse(localStorage.getItem("fairshare_recent_groups") || "[]");
    const updatedIds = recentIds.filter(x => x !== id);
    localStorage.setItem("fairshare_recent_groups", JSON.stringify(updatedIds));
  }

  async createGroup(name, currency = "$", initialMembers = ["Ban", "ED", "Juin", "Bin", "Dennis", "Yan"]) {
    const id = "cloud_" + Math.random().toString(36).substring(2, 11);
    const bankDetails = {};
    initialMembers.forEach(m => {
      bankDetails[m] = {
        bankName: "",
        accountNumber: "",
        fullName: m === "Ban" ? "Ban Lim" : m === "ED" ? "ED Tan" : m,
        qrCode: ""
      };
    });
    const newGroup = {
      id,
      name,
      currency,
      members: initialMembers,
      expenses: [],
      settlements: [],
      bankDetails,
      updatedAt: Date.now()
    };
    await this.saveGroup(newGroup);
    return newGroup;
  }

  listenToGroup(id, callback) {
    let unsubscribe = () => {};
    
    // Set up real-time listener
    import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js").then(({ doc, onSnapshot }) => {
      const docRef = doc(this.db, this.collectionName, id);
      unsubscribe = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
          callback(docSnap.data());
        } else {
          callback(null);
        }
      }, (error) => {
        console.error("Firestore listen error:", error);
      });
    });

    return () => unsubscribe();
  }

  trackRecentGroup(id) {
    const recentIds = JSON.parse(localStorage.getItem("fairshare_recent_groups") || "[]");
    if (!recentIds.includes(id)) {
      recentIds.push(id);
      localStorage.setItem("fairshare_recent_groups", JSON.stringify(recentIds));
    }
  }
}

// --- Application Core Coordinator ---

class SataSplitApp {
  constructor() {
    this.storage = new LocalStorageAdapter(); // Default
    this.activeGroup = null;
    this.currentUser = localStorage.getItem("fairshare_my_name") || "Ban";
    this.activeTab = "expenses";
    this.unsubscribeActiveListener = null;
    this.lastDeletedItem = null;
    this.settleReceiptDataUrl = "";
    this.activeFilterPill = "all";
    this.rateCache = {};
    this.attachedReceiptBase64 = "";
    this.isBatchSelectionMode = false;
    this.selectedExpenseIds = new Set();
    
    this.init();
  }

  async init() {
    // 1. Theme setup
    const savedTheme = localStorage.getItem("fairshare_theme") || "dark";
    if (savedTheme === "light") {
      document.body.classList.add("light-theme");
      this.updateThemeIcons(true);
    } else {
      this.updateThemeIcons(false);
    }

    // 2. Firebase check
    const firebaseConfig = window.FIREBASE_CONFIG;
    const hasConfig = firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY";
    
    if (hasConfig) {
      const success = await initFirebase(firebaseConfig);
      if (success) {
        this.storage = new FirestoreAdapter(firestoreDb);
        const badge = document.getElementById("sync-status-badge");
        badge.className = "sync-badge cloud";
        badge.querySelector(".label").textContent = "Cloud Synced";
      } else {
        this.showToast("Failed to connect to Firebase. Running in Offline Local Mode.", "error");
      }
    }

    // 3. Load active group (check URL params first)
    const urlParams = new URLSearchParams(window.location.search);
    const urlGroupId = urlParams.get("groupId");
    
    let groupToLoad = "default-group";
    if (urlGroupId) {
      const groupExists = await this.storage.getGroup(urlGroupId);
      if (groupExists) {
        groupToLoad = urlGroupId;
      } else {
        this.showToast("Shared group not found. Loading local default.", "error");
        // Clean URL parameter if group doesn't exist
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } else {
      // Load last active group from localStorage
      const lastGroup = localStorage.getItem("fairshare_last_active_group");
      if (lastGroup) {
        const groupExists = await this.storage.getGroup(lastGroup);
        if (groupExists) groupToLoad = lastGroup;
      }
    }

    this.switchGroup(groupToLoad);
    this.setupEventListeners();
    this.checkIosInstallPrompt();
  }

  // --- Real-time state syncing ---
  
  switchGroup(groupId) {
    // Clear previous listener
    if (this.unsubscribeActiveListener) {
      this.unsubscribeActiveListener();
    }

    // Start listening to the new group
    this.unsubscribeActiveListener = this.storage.listenToGroup(groupId, async (groupData) => {
      if (groupData) {
        this.activeGroup = groupData;
        localStorage.setItem("fairshare_last_active_group", groupId);
        
        // Reset filters when switching groups
        this.activeFilterPill = "all";
        this.exitBatchSelectionMode();
        const filterPills = document.querySelectorAll(".filter-pill");
        filterPills.forEach(p => {
          if (p.getAttribute("data-filter") === "all") {
            p.classList.add("active");
          } else {
            p.classList.remove("active");
          }
        });
        
        // Ensure currentUser is preserved and not overwritten on cloud snapshots
        const savedName = localStorage.getItem("fairshare_my_name");
        if (this.currentUser && this.activeGroup.members.includes(this.currentUser)) {
          localStorage.setItem("fairshare_my_name", this.currentUser);
        } else if (savedName && this.activeGroup.members.includes(savedName)) {
          this.currentUser = savedName;
        } else if (this.activeGroup.members.length > 0) {
          this.currentUser = this.activeGroup.members[0];
          localStorage.setItem("fairshare_my_name", this.currentUser);
        }
        
        this.updateGroupSelects();
        this.renderDashboard();
        this.checkOnboarding();
      } else {
        // Group data is null (does not exist in storage)
        if (groupId === "default-group") {
          console.log("default-group not found. Creating it...");
          const defaultGroup = {
            id: "default-group",
            name: "Apartment Share",
            currency: "$",
            members: ["Ban", "ED", "Juin", "Bin", "Dennis", "Yan"],
            expenses: [],
            settlements: [],
            bankDetails: {
              "Ban": { fullName: "Ban Lim", bankName: "Maybank", accountNumber: "1642234455", qrCode: "" },
              "ED": { fullName: "ED Tan", bankName: "CIMB", accountNumber: "7065543210", qrCode: "" },
              "Juin": { fullName: "Juin", bankName: "", accountNumber: "", qrCode: "" },
              "Bin": { fullName: "Bin", bankName: "", accountNumber: "", qrCode: "" },
              "Dennis": { fullName: "Dennis", bankName: "", accountNumber: "", qrCode: "" },
              "Yan": { fullName: "Yan", bankName: "", accountNumber: "", qrCode: "" }
            },
            updatedAt: Date.now()
          };
          await this.storage.saveGroup(defaultGroup);
        } else {
          this.showToast("Group not found. Redirecting to default group.", "error");
          this.switchGroup("default-group");
        }
      }
    });

    // Update URL parameter without reloading
    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + `?groupId=${groupId}`;
    window.history.replaceState({ path: newUrl }, "", newUrl);
  }

  async triggerStateSave() {
    if (this.activeGroup) {
      if (!navigator.onLine && isFirebaseEnabled) {
        console.log("Device offline. Queuing write transaction locally...");
        localStorage.setItem("fairshare_offline_queued_group_" + this.activeGroup.id, JSON.stringify(this.activeGroup));
        this.showToast("Offline mode: changes queued and will sync when online.", "warning");
        this.renderDashboard();
        return;
      }
      
      try {
        await this.storage.saveGroup(this.activeGroup);
        if (!isFirebaseEnabled) {
          this.renderDashboard();
        }
      } catch (err) {
        console.error("Firestore Save Error: ", err);
        this.showToast("Cloud sync failed! Update Firestore Rules in console.", "error");
        // Save backing clone in localStorage
        localStorage.setItem("fairshare_last_active_group_backup", JSON.stringify(this.activeGroup));
      }
    }
  }

  // --- Calculations ---

  calculateBalances() {
    const balances = {};
    if (!this.activeGroup) return balances;

    // Initialize all members to 0 balance
    this.activeGroup.members.forEach(member => {
      balances[member] = 0;
    });

    // 1. Regular Expenses
    this.activeGroup.expenses.forEach(exp => {
      const amount = parseFloat(exp.amount) || 0;
      const payer = exp.paidBy;
      
      // Credit the payer
      if (balances[payer] !== undefined) {
        balances[payer] += amount;
      }

      // Calculate shares based on split type
      const activeMembers = Object.keys(exp.splits).filter(m => this.activeGroup.members.includes(m));
      
      if (exp.splitType === "equal") {
        const share = amount / activeMembers.length;
        activeMembers.forEach(m => {
          balances[m] -= share;
        });
      } else if (exp.splitType === "exact") {
        activeMembers.forEach(m => {
          const val = parseFloat(exp.splits[m]) || 0;
          balances[m] -= val;
        });
      } else if (exp.splitType === "shares") {
        const totalShares = activeMembers.reduce((sum, m) => sum + (parseFloat(exp.splits[m]) || 0), 0);
        if (totalShares > 0) {
          activeMembers.forEach(m => {
            const memberShare = parseFloat(exp.splits[m]) || 0;
            balances[m] -= amount * (memberShare / totalShares);
          });
        }
      } else if (exp.splitType === "percentage") {
        activeMembers.forEach(m => {
          const pct = parseFloat(exp.splits[m]) || 0;
          balances[m] -= amount * (pct / 100);
        });
      }
    });

    // 2. Settlements
    this.activeGroup.settlements.forEach(set => {
      const amount = parseFloat(set.amount) || 0;
      const payer = set.payer;
      const recipient = set.recipient;

      // Payer clears debt -> positive impact on balance
      if (balances[payer] !== undefined) {
        balances[payer] += amount;
      }
      // Recipient gets paid -> negative impact on balance
      if (balances[recipient] !== undefined) {
        balances[recipient] -= amount;
      }
    });

    return balances;
  }

  simplifyDebts(balances) {
    // Format balances into {name, balance} objects
    const list = Object.entries(balances)
      .map(([name, bal]) => ({ name, balance: bal }))
      .filter(u => Math.abs(u.balance) >= 0.01); // Filter out zero balances

    const debtors = list.filter(u => u.balance < 0).sort((a, b) => a.balance - b.balance); // Most negative first
    const creditors = list.filter(u => u.balance > 0).sort((a, b) => b.balance - a.balance); // Most positive first

    const simplifiedTransactions = [];

    while (debtors.length > 0 && creditors.length > 0) {
      const debtor = debtors[0];
      const creditor = creditors[0];

      const amountToTransfer = Math.min(-debtor.balance, creditor.balance);
      
      simplifiedTransactions.push({
        from: debtor.name,
        to: creditor.name,
        amount: parseFloat(amountToTransfer.toFixed(2))
      });

      debtor.balance += amountToTransfer;
      creditor.balance -= amountToTransfer;

      if (Math.abs(debtor.balance) < 0.01) {
        debtors.shift();
      } else {
        debtors.sort((a, b) => a.balance - b.balance);
      }

      if (Math.abs(creditor.balance) < 0.01) {
        creditors.shift();
      } else {
        creditors.sort((a, b) => b.balance - a.balance);
      }
    }

    return simplifiedTransactions;
  }

  // --- UI Rendering ---

  async updateGroupSelects() {
    const groupSelect = document.getElementById("group-select");
    const userSelect = document.getElementById("user-select");
    if (!groupSelect || !userSelect) return;
    
    // Populate Group dropdown
    const allGroups = await this.storage.getGroups();
    
    // Clear list right before drawing (prevents concurrent race duplicates)
    groupSelect.innerHTML = "";
    userSelect.innerHTML = "";
    
    // Ensure activeGroup is in the list
    if (this.activeGroup && !allGroups[this.activeGroup.id]) {
      allGroups[this.activeGroup.id] = this.activeGroup;
    }

    Object.values(allGroups).forEach(group => {
      const opt = document.createElement("option");
      opt.value = group.id;
      opt.textContent = group.name;
      opt.selected = (group.id === this.activeGroup?.id);
      groupSelect.appendChild(opt);
    });

    // Populate Active User dropdown
    if (this.activeGroup) {
      this.activeGroup.members.forEach(member => {
        const opt = document.createElement("option");
        opt.value = member;
        opt.textContent = `User: ${member}`;
        opt.selected = (member === this.currentUser);
        userSelect.appendChild(opt);
      });
    }
  }

  renderDashboard() {
    if (!this.activeGroup) return;

    const currency = this.activeGroup.currency;
    const balances = this.calculateBalances();
    const simplifiedDebts = this.simplifyDebts(balances);

    // 1. Stats Banner
    const totalSpend = this.activeGroup.expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    document.getElementById("stat-total-spend").textContent = `${currency}${totalSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const myBalance = balances[this.currentUser] || 0;
    const netEl = document.getElementById("stat-net-balance");
    netEl.textContent = `${myBalance >= 0 ? "+" : ""}${currency}${myBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    netEl.className = `stat-value ${myBalance > 0.01 ? "success" : myBalance < -0.01 ? "danger" : ""}`;

    // Calculate aggregate "Owed" / "Owe" based on simplified debts
    let totalOwedToMe = 0;
    let totalIOwe = 0;
    
    simplifiedDebts.forEach(d => {
      if (d.to === this.currentUser) {
        totalOwedToMe += d.amount;
      }
      if (d.from === this.currentUser) {
        totalIOwe += d.amount;
      }
    });

    document.getElementById("stat-you-are-owed").textContent = `${currency}${totalOwedToMe.toFixed(2)}`;
    document.getElementById("stat-you-owe").textContent = `${currency}${totalIOwe.toFixed(2)}`;

    // 2. Sidebar members
    const membersListContainer = document.getElementById("sidebar-members-list");
    membersListContainer.innerHTML = "";
    this.activeGroup.members.forEach(m => {
      const item = document.createElement("div");
      item.className = "member-item";
      
      const bal = balances[m] || 0;
      const balText = bal > 0.01 ? `owes you ${currency}${bal.toFixed(2)}` : bal < -0.01 ? `owes ${currency}${Math.abs(bal).toFixed(2)}` : "settled up";
      const balClass = bal > 0.01 ? "positive" : bal < -0.01 ? "negative" : "neutral";

      const hasBank = this.activeGroup.bankDetails && this.activeGroup.bankDetails[m] && this.activeGroup.bankDetails[m].accountNumber;
      const bankStyle = hasBank ? "color: var(--primary-color); opacity: 1;" : "color: var(--text-muted); opacity: 0.35;";
      const bankTitle = hasBank ? "🏦 View Bank Details" : "🏦 Setup Bank Details";

      item.innerHTML = `
        <div class="member-detail" style="flex: 1; min-width: 0;">
          <div class="user-avatar">${m.charAt(0).toUpperCase()}</div>
          <div class="member-name" style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 100px;">
            ${m} ${m === this.currentUser ? '<span class="member-active-badge">You</span>' : ""}
          </div>
          <button class="action-btn-sm btn-member-bank" data-member="${m}" style="padding: 0.15rem 0.35rem; margin-left: 0.35rem; ${bankStyle}" title="${bankTitle}">🏦</button>
        </div>
        <span class="balance-val ${balClass}" style="font-size: 0.8rem; flex-shrink: 0;">
          ${m === this.currentUser ? (bal > 0 ? `owed ${currency}${bal.toFixed(2)}` : bal < 0 ? `owe ${currency}${Math.abs(bal).toFixed(2)}` : "settled") : balText}
        </span>
      `;
      membersListContainer.appendChild(item);
    });

    // Bind click listeners for bank details
    membersListContainer.querySelectorAll(".btn-member-bank").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const member = btn.getAttribute("data-member");
        this.openBankDialog(member);
      });
    });

    // 3. Shareable Link
    document.getElementById("share-url-text").textContent = window.location.href;

    // 4. Active Tab Render
    if (this.activeTab === "expenses") {
      this.renderExpensesList(balances);
    } else if (this.activeTab === "activity") {
      this.renderActivityFeed();
    } else if (this.activeTab === "notes") {
      this.renderNotesWall();
    }

    // 5. Balances List Tab
    const balancesListContainer = document.getElementById("balances-list");
    balancesListContainer.innerHTML = "";
    Object.entries(balances).forEach(([m, bal]) => {
      const item = document.createElement("div");
      item.className = "balance-item";
      
      const balClass = bal > 0.01 ? "positive" : bal < -0.01 ? "negative" : "neutral";
      const sign = bal > 0.01 ? "+" : "";

      item.innerHTML = `
        <div class="balance-user-info">
          <div class="user-avatar">${m.charAt(0).toUpperCase()}</div>
          <div style="font-weight: 600;">${m}</div>
        </div>
        <div class="balance-val ${balClass}">${sign}${currency}${bal.toFixed(2)}</div>
      `;
      balancesListContainer.appendChild(item);
    });

    // 6. Simplified Debts List Tab
    const debtsListContainer = document.getElementById("debts-list");
    debtsListContainer.innerHTML = "";
    if (simplifiedDebts.length === 0) {
      debtsListContainer.innerHTML = `
        <div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted);">
          🎉 Everyone is fully settled! No debts to display.
        </div>
      `;
    } else {
      simplifiedDebts.forEach(debt => {
        const card = document.createElement("div");
        card.className = "debt-card";
        
        card.innerHTML = `
          <div class="debt-flow">
            <div class="debt-entity">
              <div class="user-avatar">${debt.from.charAt(0).toUpperCase()}</div>
              <span>${debt.from}</span>
            </div>
            
            <div class="debt-arrow">
              <span class="debt-amount-label">${currency}${debt.amount.toFixed(2)}</span>
              <div class="debt-arrow-line"></div>
            </div>
            
            <div class="debt-entity">
              <div class="user-avatar">${debt.to.charAt(0).toUpperCase()}</div>
              <span>${debt.to}</span>
            </div>
          </div>
          <div class="debt-action-row">
            <button class="btn btn-secondary btn-quick-settle" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;" 
              data-payer="${debt.from}" data-recipient="${debt.to}" data-amount="${debt.amount}">
              ⚡ Record Payment
            </button>
          </div>
        `;
        debtsListContainer.appendChild(card);
      });
      
      // Add Event Listeners for quick settle buttons
      debtsListContainer.querySelectorAll(".btn-quick-settle").forEach(btn => {
        btn.addEventListener("click", (e) => {
          const payer = btn.getAttribute("data-payer");
          const recipient = btn.getAttribute("data-recipient");
          const amount = btn.getAttribute("data-amount");
          this.openSettleDialog(payer, recipient, amount);
        });
      });
    }

    // 7. Settlements History Ledger
    const settlementsHistory = document.getElementById("settlements-history-list");
    settlementsHistory.innerHTML = "";
    if (this.activeGroup.settlements.length === 0) {
      settlementsHistory.innerHTML = `
        <div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted); font-size: 0.9rem;">
          No settlements have been recorded yet in this group.
        </div>
      `;
    } else {
      // Sort settlements newest first
      const sortedSettlements = [...this.activeGroup.settlements].sort((a, b) => new Date(b.date) - new Date(a.date));
      sortedSettlements.forEach(set => {
        const card = document.createElement("div");
        card.className = "expense-card";
        
        const dateObj = new Date(set.date);
        const formattedDate = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

        const hasReceipt = set.receipt && set.receipt.length > 0;
        const receiptButtonHtml = hasReceipt 
          ? `<button type="button" class="action-btn-sm btn-view-receipt" style="margin-left: 0.5rem; padding: 0.15rem 0.4rem; font-size: 0.75rem; border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 4px; background: rgba(99, 102, 241, 0.05); color: var(--primary-color);" title="View payment receipt">📄 View Receipt</button>` 
          : "";

        card.innerHTML = `
          <div class="expense-info">
            <div class="category-icon" style="background-color: var(--success-light); color: var(--success-color);">💸</div>
            <div class="expense-text">
              <div class="expense-title" style="display: flex; align-items: center; flex-wrap: wrap; gap: 0.35rem;">
                <strong>${set.payer}</strong> settled up with <strong>${set.recipient}</strong>
                ${receiptButtonHtml}
              </div>
              <div class="expense-meta">${formattedDate}</div>
            </div>
          </div>
          <div class="expense-split-details">
            <div class="expense-amount-block">
              <div class="expense-amount-label">Settlement Amount</div>
              <div class="expense-amount-val" style="color: var(--success-color);">${currency}${parseFloat(set.amount).toFixed(2)}</div>
            </div>
            
            <div class="expense-actions" style="margin-left: 1rem;">
              <button class="action-btn-sm btn-delete-settlement" data-id="${set.id}" title="Delete Settlement">🗑️</button>
            </div>
          </div>
        `;
        
        card.querySelector(".btn-delete-settlement").addEventListener("click", (e) => {
          e.stopPropagation();
          if (confirm("Delete this settlement record?")) {
            this.deleteSettlement(set.id);
          }
        });
        
        if (hasReceipt) {
          card.querySelector(".btn-view-receipt").addEventListener("click", (e) => {
            e.stopPropagation();
            const lightbox = document.getElementById("receipt-lightbox-dialog");
            const lightboxImg = document.getElementById("receipt-lightbox-img");
            const lightboxTitle = document.getElementById("receipt-lightbox-title");
            
            lightboxImg.src = set.receipt;
            lightboxTitle.textContent = `${set.payer} ➔ ${set.recipient} (${currency}${parseFloat(set.amount).toFixed(2)})`;
            
            lightbox.style.display = "flex";
            lightbox.showModal();
          });
        }
        
        settlementsHistory.appendChild(card);
      });
    }
    const panel = document.getElementById("analytics-panel");
    if (panel && panel.style.display === "block") {
      this.renderAnalytics();
    }
    if (this.activeTab === "notes") {
      this.renderNotesWall();
    }
    this.renderActivityFeed();
  }

  renderExpensesList(balances) {
    const container = document.getElementById("expenses-list");
    container.innerHTML = "";

    const currency = this.activeGroup.currency;
    const searchVal = document.getElementById("expense-search").value.toLowerCase();
    const categoryVal = document.getElementById("expense-filter-category").value;

    const filtered = this.activeGroup.expenses.filter(exp => {
      const matchSearch = exp.description.toLowerCase().includes(searchVal) || 
                          (exp.category && exp.category.toLowerCase().includes(searchVal)) ||
                          exp.paidBy.toLowerCase().includes(searchVal);
      const matchCat = categoryVal === "all" || exp.category === categoryVal;
      
      let matchPill = true;
      if (this.activeFilterPill === "paid-by-me") {
        matchPill = exp.paidBy === this.currentUser;
      } else if (this.activeFilterPill === "unequal") {
        matchPill = exp.splitType && exp.splitType !== "equal";
      } else if (this.activeFilterPill === "high-value") {
        matchPill = (parseFloat(exp.amount) || 0) > 100;
      } else if (this.activeFilterPill === "this-month") {
        const expDate = new Date(exp.date);
        const now = new Date();
        matchPill = expDate.getFullYear() === now.getFullYear() && expDate.getMonth() === now.getMonth();
      }

      return matchSearch && matchCat && matchPill;
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5h.007v.008H3.75V4.5Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3 7.5h18M5.25 7.5V16.5a1.5 1.5 0 0 0 1.5 1.5h10.5a1.5 1.5 0 0 0 1.5-1.5V7.5M9 10.5h6"></path></svg>
          <p>No matching expenses found.</p>
        </div>
      `;
      return;
    }

    // Sort: newest date first
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Category Map Icons & colors
    const categoryMeta = {
      meals: { icon: "🍔", bg: "rgba(245, 158, 11, 0.15)", color: "#f59e0b" },
      transport: { icon: "🚗", bg: "rgba(59, 130, 246, 0.15)", color: "#3b82f6" },
      lodging: { icon: "🏨", bg: "rgba(139, 92, 246, 0.15)", color: "#8b5aF6" },
      groceries: { icon: "🛒", bg: "rgba(16, 185, 129, 0.15)", color: "#10b981" },
      entertainment: { icon: "🍿", bg: "rgba(236, 72, 153, 0.15)", color: "#ec4899" },
      utilities: { icon: "⚡", bg: "rgba(6, 182, 212, 0.15)", color: "#06b6d4" },
      other: { icon: "📦", bg: "rgba(100, 116, 139, 0.15)", color: "#64748b" }
    };

    filtered.forEach(exp => {
      const card = document.createElement("div");
      const isSelected = this.selectedExpenseIds.has(exp.id);
      card.className = `expense-card ${this.isBatchSelectionMode ? "batch-selectable" : ""} ${isSelected ? "batch-selected" : ""}`;
      
      const meta = categoryMeta[exp.category] || categoryMeta.other;
      const dateObj = new Date(exp.date);
      const formattedDate = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      
      // Calculate how much you (currentUser) paid, and what your share is
      const amount = parseFloat(exp.amount) || 0;
      const isPayer = (exp.paidBy === this.currentUser);
      
      let userShareAmount = 0;
      const activeMembers = Object.keys(exp.splits).filter(m => this.activeGroup.members.includes(m));
      const hasShare = exp.splits[this.currentUser] !== undefined;

      if (hasShare) {
        if (exp.splitType === "equal") {
          userShareAmount = amount / activeMembers.length;
        } else if (exp.splitType === "exact") {
          userShareAmount = parseFloat(exp.splits[this.currentUser]) || 0;
        } else if (exp.splitType === "shares") {
          const totalShares = activeMembers.reduce((sum, m) => sum + (parseFloat(exp.splits[m]) || 0), 0);
          const myShareWeight = parseFloat(exp.splits[this.currentUser]) || 0;
          userShareAmount = totalShares > 0 ? amount * (myShareWeight / totalShares) : 0;
        } else if (exp.splitType === "percentage") {
          const myPct = parseFloat(exp.splits[this.currentUser]) || 0;
          userShareAmount = amount * (myPct / 100);
        }
      }

      // Net impact of this bill on currentUser
      let userNet = 0;
      if (isPayer) {
        userNet = amount - userShareAmount;
      } else {
        userNet = -userShareAmount;
      }

      let shareText = "";
      let shareClass = "";
      if (userNet > 0.01) {
        shareText = `You lent ${currency}${userNet.toFixed(2)}`;
        shareClass = "owed";
      } else if (userNet < -0.01) {
        shareText = `You borrowed ${currency}${Math.abs(userNet).toFixed(2)}`;
        shareClass = "owe";
      } else {
        shareText = isPayer ? "You paid for yourself" : "No share";
        shareClass = "neutral";
      }

      card.innerHTML = `
        ${this.isBatchSelectionMode ? `
          <div style="display: flex; align-items: center; padding-right: 0.5rem;">
            <input type="checkbox" class="expense-batch-checkbox" data-id="${exp.id}" ${isSelected ? "checked" : ""}>
          </div>
        ` : ""}
        <div class="expense-info">
          <div class="category-icon" style="background-color: ${meta.bg}; color: ${meta.color};">${meta.icon}</div>
          <div class="expense-text">
            <div class="expense-title">${exp.description}</div>
            <div class="expense-meta">
              Paid by <strong>${exp.paidBy}</strong>
              <span class="expense-meta-dot">•</span>
              ${formattedDate}
              ${exp.hasReceipt ? `<br><span class="receipt-badge-card btn-view-receipt" data-id="${exp.id}">📷 View Receipt</span>` : ""}
            </div>
          </div>
        </div>
        
        <div class="expense-split-details">
          <div class="expense-amount-block">
            <div class="expense-amount-label">Total Cost</div>
            <div class="expense-amount-val">${currency}${amount.toFixed(2)}</div>
          </div>
          
          <div class="expense-user-share ${shareClass}">
            <div class="expense-amount-label" style="text-align: right;">${isPayer ? "Your Share" : "Your Debt"}</div>
            <div style="font-weight: 700;">${shareText}</div>
          </div>
          
          ${!this.isBatchSelectionMode ? `
            <div class="expense-actions">
              <button class="action-btn-sm btn-edit-expense" data-id="${exp.id}" title="Edit Expense">✏️</button>
              <button class="action-btn-sm btn-delete-expense" data-id="${exp.id}" title="Delete Expense">🗑️</button>
            </div>
          ` : ""}
        </div>
      `;

      if (!this.isBatchSelectionMode) {
        // Event handlers for actions
        const btnEdit = card.querySelector(".btn-edit-expense");
        if (btnEdit) {
          btnEdit.addEventListener("click", (e) => {
            e.stopPropagation();
            this.openExpenseForm(exp);
          });
        }

        const btnDel = card.querySelector(".btn-delete-expense");
        if (btnDel) {
          btnDel.addEventListener("click", (e) => {
            e.stopPropagation();
            if (confirm(`Delete the expense "${exp.description}"?`)) {
              this.deleteExpense(exp.id);
            }
          });
        }
      }

      if (exp.hasReceipt) {
        const btnView = card.querySelector(".btn-view-receipt");
        if (btnView) {
          btnView.addEventListener("click", async (e) => {
            e.stopPropagation();
            this.vibrate(10);
            
            const lightbox = document.getElementById("receipt-lightbox-dialog");
            const lightboxImg = document.getElementById("receipt-lightbox-img");
            const lightboxTitle = document.getElementById("receipt-lightbox-title");
            
            if (lightbox && lightboxImg && lightboxTitle) {
              lightboxImg.style.display = "none";
              lightboxImg.src = "";
              lightboxTitle.textContent = `Loading Receipt for "${exp.description}"...`;
              lightbox.showModal();
              
              const imageBase64 = await this.getReceiptImage(exp.id);
              if (imageBase64) {
                lightboxImg.src = imageBase64;
                lightboxImg.style.display = "block";
                lightboxTitle.textContent = `Receipt Proof: "${exp.description}"`;
              } else {
                lightboxTitle.textContent = `⚠️ Receipt Image Not Found (Purged or missing)`;
              }
            }
          });
        }
      }
      
      // Card click handling
      if (this.isBatchSelectionMode) {
        card.addEventListener("click", () => {
          this.vibrate(10);
          if (this.selectedExpenseIds.has(exp.id)) {
            this.selectedExpenseIds.delete(exp.id);
            card.classList.remove("batch-selected");
          } else {
            this.selectedExpenseIds.add(exp.id);
            card.classList.add("batch-selected");
          }
          const chk = card.querySelector(".expense-batch-checkbox");
          if (chk) chk.checked = this.selectedExpenseIds.has(exp.id);
          this.updateBatchSelectionCount();
        });
      } else {
        card.addEventListener("click", () => {
          this.openExpenseForm(exp);
        });
      }

      container.appendChild(card);
    });
  }

  // --- Actions & Mutations ---

  async handleReceiptAttachment(expenseId) {
    if (this.attachedReceiptBase64) {
      await this.saveReceiptImage(expenseId, this.attachedReceiptBase64);
      
      this.activeGroup.receiptList = this.activeGroup.receiptList || [];
      this.activeGroup.receiptList = this.activeGroup.receiptList.filter(item => item.expenseId !== expenseId);
      this.activeGroup.receiptList.push({ expenseId, timestamp: Date.now() });
      
      // Auto-purge oldest if > 50
      while (this.activeGroup.receiptList.length > 50) {
        const oldest = this.activeGroup.receiptList.shift();
        await this.deleteReceiptImage(oldest.expenseId);
        
        const oldExp = this.activeGroup.expenses.find(e => e.id === oldest.expenseId);
        if (oldExp) {
          delete oldExp.hasReceipt;
        }
      }
      
      this.attachedReceiptBase64 = "";
      const indicator = document.getElementById("expense-receipt-indicator");
      if (indicator) indicator.style.display = "none";
      return true;
    }
    return false;
  }

  async addExpense(expenseData) {
    if (!this.activeGroup) return;

    if (this.attachedReceiptBase64) {
      expenseData.hasReceipt = true;
      await this.handleReceiptAttachment(expenseData.id);
    }

    this.activeGroup.expenses.push(expenseData);
    this.logActivity(`added expense "${expenseData.description}" of ${this.activeGroup.currency}${parseFloat(expenseData.amount).toFixed(2)}`, false);
    await this.triggerStateSave();
    this.showToast("Expense added successfully!", "success");
  }

  async updateExpense(id, updatedData) {
    if (!this.activeGroup) return;
    const index = this.activeGroup.expenses.findIndex(e => e.id === id);
    if (index !== -1) {
      const oldDesc = this.activeGroup.expenses[index].description;
      
      if (this.attachedReceiptBase64) {
        updatedData.hasReceipt = true;
        await this.handleReceiptAttachment(id);
      }

      this.activeGroup.expenses[index] = { ...this.activeGroup.expenses[index], ...updatedData };
      this.logActivity(`updated expense "${oldDesc}" to "${updatedData.description}" (${this.activeGroup.currency}${parseFloat(updatedData.amount).toFixed(2)})`, false);
      await this.triggerStateSave();
      this.showToast("Expense updated successfully!", "success");
    }
  }

  async deleteExpense(id) {
    if (!this.activeGroup) return;
    const exp = this.activeGroup.expenses.find(e => e.id === id);
    if (!exp) return;
    
    this.lastDeletedItem = { type: "expense", data: exp };
    
    if (exp.hasReceipt) {
      const receiptData = await this.getReceiptImage(id);
      this.lastDeletedItem.receiptData = receiptData;
      await this.deleteReceiptImage(id);
      if (this.activeGroup.receiptList) {
        this.activeGroup.receiptList = this.activeGroup.receiptList.filter(item => item.expenseId !== id);
      }
    }
    
    this.activeGroup.expenses = this.activeGroup.expenses.filter(e => e.id !== id);
    this.logActivity(`deleted expense "${exp.description}"`, false);
    await this.triggerStateSave();
    
    this.showToast(`Deleted expense "${exp.description}"`, "success", "Undo", () => this.restoreLastDeletedItem());
  }

  async addSettlement(settlementData) {
    if (!this.activeGroup) return;
    this.activeGroup.settlements.push(settlementData);
    this.logActivity(`recorded settlement: paid ${settlementData.recipient} ${this.activeGroup.currency}${parseFloat(settlementData.amount).toFixed(2)}`, false);
    await this.triggerStateSave();
    this.showToast("Payment recorded successfully!", "success");
  }

  async deleteSettlement(id) {
    if (!this.activeGroup) return;
    const set = this.activeGroup.settlements.find(s => s.id === id);
    if (!set) return;
    
    this.lastDeletedItem = { type: "settlement", data: set };
    
    const text = `${set.payer} paid ${set.recipient} ${this.activeGroup.currency}${parseFloat(set.amount).toFixed(2)}`;
    this.activeGroup.settlements = this.activeGroup.settlements.filter(s => s.id !== id);
    this.logActivity(`deleted settlement: "${text}"`, false);
    await this.triggerStateSave();
    
    this.showToast("Deleted settlement.", "success", "Undo", () => this.restoreLastDeletedItem());
  }

  // --- Dialog / Form Management ---

  openExpenseForm(expenseToEdit = null) {
    const dialog = document.getElementById("expense-dialog");
    const form = document.getElementById("expense-form");
    
    // Set title
    document.getElementById("expense-dialog-title").textContent = expenseToEdit ? "Edit Expense" : "Add New Expense";
    
    // Reset Form
    form.reset();
    
    this.attachedReceiptBase64 = "";
    const indicator = document.getElementById("expense-receipt-indicator");
    if (indicator) {
      indicator.style.display = "none";
      if (expenseToEdit && expenseToEdit.hasReceipt) {
        indicator.textContent = "📎 Receipt Photo Attached";
        indicator.style.display = "inline-block";
        indicator.style.color = "var(--primary-color)";
      } else {
        indicator.textContent = "📎 Image Attached";
        indicator.style.color = "var(--success-color)";
      }
    }

    document.getElementById("expense-desc-suggestions").innerHTML = "";
    document.getElementById("expense-desc-suggestions").style.display = "none";
    
    // Populate fields
    const expIdInput = document.getElementById("expense-id-input");
    const descInput = document.getElementById("expense-desc");
    const amountInput = document.getElementById("expense-amount");
    const dateInput = document.getElementById("expense-date");
    const paidBySelect = document.getElementById("expense-paid-by");
    
    // Populate Paid By dropdown
    paidBySelect.innerHTML = "";
    this.activeGroup.members.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      paidBySelect.appendChild(opt);
    });

    if (expenseToEdit) {
      expIdInput.value = expenseToEdit.id;
      descInput.value = expenseToEdit.description;
      amountInput.value = expenseToEdit.amount;
      dateInput.value = expenseToEdit.date;
      paidBySelect.value = expenseToEdit.paidBy;
      
      // Set category
      form.querySelector(`input[name="expense-category"][value="${expenseToEdit.category}"]`).checked = true;
      
      // Set split method
      form.querySelector(`input[name="split-type"][value="${expenseToEdit.splitType}"]`).checked = true;
    } else {
      expIdInput.value = "";
      // Default date to today
      dateInput.value = new Date().toISOString().substring(0, 10);
      paidBySelect.value = this.currentUser;
      
      // Set defaults
      form.querySelector('input[name="expense-category"][value="meals"]').checked = true;
      form.querySelector('input[name="split-type"][value="equal"]').checked = true;
    }

    // Reset Currency Converter Form State
    const converterToggle = document.getElementById("expense-convert-currency-toggle");
    const converterSection = document.getElementById("currency-converter-section");
    if (converterToggle && converterSection) {
      converterToggle.checked = false;
      converterSection.style.display = "none";
      const fAmount = document.getElementById("expense-foreign-amount");
      if (fAmount) fAmount.value = "";
      
      const rateDisplay = document.getElementById("expense-exchange-rate-display");
      const previewDisplay = document.getElementById("expense-converted-preview");
      if (rateDisplay) rateDisplay.textContent = "-";
      if (previewDisplay) previewDisplay.textContent = "-";
    }

    this.renderSplitFormInputs(expenseToEdit);
    dialog.showModal();
  }

  renderSplitFormInputs(expenseToEdit = null) {
    const container = document.getElementById("split-members-list");
    container.innerHTML = "";
    
    const splitType = document.querySelector('input[name="split-type"]:checked').value;
    const amount = parseFloat(document.getElementById("expense-amount").value) || 0;
    const members = this.activeGroup.members;
    
    const count = members.length;
    
    // Label change based on type
    const detailsLabel = document.getElementById("split-details-label");
    const currency = this.activeGroup.currency;

    if (splitType === "equal") {
      detailsLabel.textContent = "Split Equally Among Members:";
    } else if (splitType === "exact") {
      detailsLabel.textContent = `Split by Exact Amount (${currency}):`;
    } else if (splitType === "shares") {
      detailsLabel.textContent = "Split by Share Ratios:";
    } else if (splitType === "percentage") {
      detailsLabel.textContent = "Split by Percentage (%):";
    }

    const equalHelpers = document.getElementById("split-equal-helpers");
    if (equalHelpers) {
      equalHelpers.style.display = splitType === "equal" ? "flex" : "none";
    }

    members.forEach(m => {
      const row = document.createElement("div");
      row.className = "split-member-row";
      
      let inputVal = "";
      let unit = "";
      let isChecked = true;

      // Extract existing val if editing
      if (expenseToEdit && expenseToEdit.splits[m] !== undefined) {
        inputVal = expenseToEdit.splits[m];
        isChecked = true;
      } else {
        // Defaults
        if (splitType === "equal") {
          isChecked = true;
        } else if (splitType === "exact") {
          inputVal = "";
        } else if (splitType === "shares") {
          inputVal = "1"; // Default 1 share
        } else if (splitType === "percentage") {
          inputVal = (100 / count).toFixed(1);
        }
      }

      if (splitType === "equal") {
        row.innerHTML = `
          <div class="split-member-meta">
            <input type="checkbox" id="split-chk-${m}" class="split-member-chk" data-member="${m}" ${isChecked ? "checked" : ""}>
            <label for="split-chk-${m}">${m}</label>
          </div>
          <div id="split-val-equal-${m}" class="split-input-val-equal" style="font-size: 0.85rem; font-weight:600; color:var(--text-secondary);">
            ${currency}${(amount / count).toFixed(2)}
          </div>
        `;
      } else {
        if (splitType === "exact") unit = currency;
        if (splitType === "shares") unit = "shares";
        if (splitType === "percentage") unit = "%";

        row.innerHTML = `
          <div class="split-member-meta">
            <input type="checkbox" id="split-chk-${m}" class="split-member-chk" data-member="${m}" checked style="display:none;">
            <label for="split-chk-${m}">${m}</label>
          </div>
          <div class="split-input-wrap">
            <input type="number" class="split-member-input" data-member="${m}" value="${inputVal}" step="any" min="0" placeholder="0">
            <span class="unit">${unit}</span>
          </div>
        `;
      }
      container.appendChild(row);
    });

    this.validateSplitInputs();
    this.bindSplitInputsListeners();
  }

  bindSplitInputsListeners() {
    const amountInput = document.getElementById("expense-amount");
    const splitInputs = document.querySelectorAll(".split-member-input");
    const splitCheckboxes = document.querySelectorAll(".split-member-chk");

    const handleUpdate = () => {
      this.validateSplitInputs();
    };

    amountInput.addEventListener("input", handleUpdate);
    splitInputs.forEach(i => i.addEventListener("input", handleUpdate));
    splitCheckboxes.forEach(c => c.addEventListener("change", () => {
      // Re-evaluate equal share calculations
      const splitType = document.querySelector('input[name="split-type"]:checked').value;
      if (splitType === "equal") {
        const amount = parseFloat(amountInput.value) || 0;
        const checkedBoxes = document.querySelectorAll(".split-member-chk:checked");
        const count = checkedBoxes.length;
        const perPerson = count > 0 ? (amount / count) : 0;
        const currency = this.activeGroup.currency;

        this.activeGroup.members.forEach(m => {
          const valDiv = document.getElementById(`split-val-equal-${m}`);
          const chk = document.getElementById(`split-chk-${m}`);
          if (valDiv) {
            valDiv.textContent = chk.checked ? `${currency}${perPerson.toFixed(2)}` : `${currency}0.00`;
          }
        });
      }
      handleUpdate();
    }));
  }

  validateSplitInputs() {
    const splitType = document.querySelector('input[name="split-type"]:checked').value;
    const amount = parseFloat(document.getElementById("expense-amount").value) || 0;
    const warning = document.getElementById("split-warning");
    const saveBtn = document.getElementById("btn-save-expense");
    
    warning.style.display = "none";
    saveBtn.disabled = false;

    if (splitType === "equal") {
      const checked = document.querySelectorAll(".split-member-chk:checked").length;
      if (checked === 0 && amount > 0) {
        warning.textContent = "Select at least one member to split with!";
        warning.style.display = "block";
        saveBtn.disabled = true;
      }
      return;
    }

    const inputs = document.querySelectorAll(".split-member-input");
    let sum = 0;
    inputs.forEach(input => {
      sum += parseFloat(input.value) || 0;
    });

    if (splitType === "exact") {
      const difference = Math.abs(sum - amount);
      if (difference > 0.02 && amount > 0) {
        warning.textContent = `Amounts must sum to exact total! Sum: ${this.activeGroup.currency}${sum.toFixed(2)} vs Total: ${this.activeGroup.currency}${amount.toFixed(2)}`;
        warning.style.display = "block";
        saveBtn.disabled = true;
      }
    } else if (splitType === "percentage") {
      const difference = Math.abs(sum - 100);
      if (difference > 0.05 && amount > 0) {
        warning.textContent = `Percentages must sum to exactly 100%! Current sum: ${sum.toFixed(1)}%`;
        warning.style.display = "block";
        saveBtn.disabled = true;
      }
    } else if (splitType === "shares") {
      if (sum === 0 && amount > 0) {
        warning.textContent = "Sum of shares must be greater than 0!";
        warning.style.display = "block";
        saveBtn.disabled = true;
      }
    }
  }

  openSettleDialog(payer = "", recipient = "", amount = "") {
    const dialog = document.getElementById("settle-dialog");
    const form = document.getElementById("settle-form");
    
    form.reset();

    // Reset receipt upload state
    this.settleReceiptDataUrl = "";
    document.getElementById("settle-input-receipt").value = "";
    document.getElementById("settle-receipt-preview").src = "";
    document.getElementById("settle-receipt-preview-container").style.display = "none";

    const payerSelect = document.getElementById("settle-payer");
    const recSelect = document.getElementById("settle-recipient");
    const amountInput = document.getElementById("settle-amount");

    // Populate dropdowns
    payerSelect.innerHTML = "";
    recSelect.innerHTML = "";

    this.activeGroup.members.forEach(m => {
      const optP = document.createElement("option");
      optP.value = m;
      optP.textContent = m;
      if (m === payer) optP.selected = true;
      payerSelect.appendChild(optP);

      const optR = document.createElement("option");
      optR.value = m;
      optR.textContent = m;
      if (m === recipient) optR.selected = true;
      recSelect.appendChild(optR);
    });

    if (amount) {
      amountInput.value = parseFloat(amount).toFixed(2);
    }

    // Load bank details for recipient
    const updateSettleBankDetails = () => {
      const rec = recSelect.value;
      const bankPanel = document.getElementById("settle-bank-details");
      const qrPanel = document.getElementById("settle-qr-container");
      this.activeGroup.bankDetails = this.activeGroup.bankDetails || {};
      const det = this.activeGroup.bankDetails[rec];
      
      if (det && det.accountNumber) {
        document.getElementById("settle-bank-name").textContent = det.bankName;
        document.getElementById("settle-bank-acct").textContent = det.accountNumber;
        document.getElementById("settle-bank-holder").textContent = det.fullName;
        bankPanel.style.display = "block";
        
        if (det.qrCode) {
          document.getElementById("settle-qr-img").src = det.qrCode;
          qrPanel.style.display = "flex";
        } else if (det.duitnowId) {
          const settleAmount = amountInput.value || "0.00";
          const qrData = this.generateDuitNowEMVCo(det.duitnowType, det.duitnowId, det.fullName, settleAmount, this.activeGroup.currency);
          document.getElementById("settle-qr-img").src = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + encodeURIComponent(qrData);
          qrPanel.style.display = "flex";
        } else {
          qrPanel.style.display = "none";
        }
      } else {
        bankPanel.style.display = "none";
        qrPanel.style.display = "none";
      }
    };
    
    updateSettleBankDetails();

    dialog.showModal();
  }

  openGroupSettings() {
    const dialog = document.getElementById("group-dialog");
    const nameInput = document.getElementById("group-name-input");
    const currencySelect = document.getElementById("group-currency-input");
    const list = document.getElementById("group-members-list");

    nameInput.value = this.activeGroup.name;
    currencySelect.value = this.activeGroup.currency;
    
    list.innerHTML = "";
    
    // Check which members are referenced in expenses
    const lockedMembers = new Set();
    this.activeGroup.expenses.forEach(e => {
      lockedMembers.add(e.paidBy);
      Object.keys(e.splits).forEach(m => lockedMembers.add(m));
    });
    this.activeGroup.settlements.forEach(s => {
      lockedMembers.add(s.payer);
      lockedMembers.add(s.recipient);
    });

    this.activeGroup.members.forEach(m => {
      const row = document.createElement("div");
      row.className = "split-member-row";
      
      const isLocked = lockedMembers.has(m);
      const actionHtml = isLocked 
        ? `<span style="font-size:0.75rem; color:var(--text-muted);">locked (has bills)</span>`
        : `<button type="button" class="action-btn-sm btn-remove-member" data-member="${m}" style="color:var(--danger-color);">Remove</button>`;

      row.innerHTML = `
        <div style="font-weight: 500;">${m}</div>
        <div>${actionHtml}</div>
      `;

      if (!isLocked) {
        row.querySelector(".btn-remove-member").addEventListener("click", () => {
          this.activeGroup.members = this.activeGroup.members.filter(mem => mem !== m);
          this.openGroupSettings(); // Refresh dialog
        });
      }

      list.appendChild(row);
    });

    dialog.showModal();
  }

  openBankDialog(member) {
    const dialog = document.getElementById("member-bank-dialog");
    const title = document.getElementById("bank-dialog-title");
    const viewSection = document.getElementById("bank-details-view");
    const editForm = document.getElementById("bank-details-form");
    
    title.innerHTML = `🏦 Bank Details for <strong>${member}</strong>`;
    
    this.activeGroup.bankDetails = this.activeGroup.bankDetails || {};
    const details = this.activeGroup.bankDetails[member] || null;
    
    const viewName = document.getElementById("bank-view-name");
    const viewAcct = document.getElementById("bank-view-acct");
    const viewHolder = document.getElementById("bank-view-holder");
    const viewQrContainer = document.getElementById("bank-view-qr-container");
    const viewQrImg = document.getElementById("bank-view-qr-img");
    
    if (details && details.accountNumber) {
      viewName.textContent = details.bankName;
      viewAcct.textContent = details.accountNumber;
      viewHolder.textContent = details.fullName;
      document.getElementById("btn-copy-bank-acct").style.display = "inline-flex";
      
      if (details.duitnowId) {
        document.getElementById("bank-view-duitnow").textContent = details.duitnowId;
        document.getElementById("bank-view-duitnow-type").textContent = `(${details.duitnowType})`;
        document.getElementById("btn-copy-bank-duitnow").style.display = "inline-flex";
      } else {
        document.getElementById("bank-view-duitnow").textContent = "—";
        document.getElementById("bank-view-duitnow-type").textContent = "";
        document.getElementById("btn-copy-bank-duitnow").style.display = "none";
      }
      
      if (details.qrCode) {
        viewQrImg.src = details.qrCode;
        viewQrContainer.style.display = "flex";
      } else {
        viewQrContainer.style.display = "none";
      }
    } else {
      viewName.textContent = "(Not set)";
      viewAcct.textContent = "—";
      viewHolder.textContent = "(Not set)";
      document.getElementById("bank-view-duitnow").textContent = "—";
      document.getElementById("bank-view-duitnow-type").textContent = "";
      document.getElementById("btn-copy-bank-acct").style.display = "none";
      document.getElementById("btn-copy-bank-duitnow").style.display = "none";
      viewQrContainer.style.display = "none";
    }
    
    viewSection.style.display = "flex";
    editForm.style.display = "none";
    
    document.getElementById("bank-member-name").value = member;
    document.getElementById("bank-input-name").value = details ? details.bankName : "";
    document.getElementById("bank-input-acct").value = details ? details.accountNumber : "";
    document.getElementById("bank-input-holder").value = details ? details.fullName : (member === "Ban" ? "Ban Lim" : member);
    document.getElementById("bank-input-duitnow").value = (details && details.duitnowId) ? details.duitnowId : "";
    document.getElementById("bank-input-duitnow-type").value = (details && details.duitnowType) ? details.duitnowType : "phone";
    
    // QR Code Edit Mode Setup
    document.getElementById("bank-input-qr").value = "";
    this.editingQrDataUrl = (details && details.qrCode) ? details.qrCode : "";
    
    const previewContainer = document.getElementById("bank-edit-qr-preview-container");
    if (this.editingQrDataUrl) {
      document.getElementById("bank-edit-qr-preview").src = this.editingQrDataUrl;
      previewContainer.style.display = "flex";
    } else {
      previewContainer.style.display = "none";
    }
    
    dialog.showModal();
  }

  // --- Preloaded Demo Dataset ---

  loadDemoData() {
    const currency = this.activeGroup?.currency || "$";
    const demoGroup = {
      id: "demo-penang-trip",
      name: "Road Trip to Penang 🏝️",
      currency: currency,
      members: ["Ban", "ED", "Juin", "Bin", "Dennis", "Yan"],
      bankDetails: {
        "Ban": { fullName: "Ban Lim", bankName: "Maybank", accountNumber: "1642234455" },
        "ED": { fullName: "ED Tan", bankName: "CIMB", accountNumber: "7065543210" }
      },
      expenses: [
        {
          id: "demo-exp-1",
          description: "Airbnb Villa Booking",
          amount: 600,
          date: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
          category: "lodging",
          paidBy: "Ban",
          splitType: "equal",
          splits: { Ban: 1, ED: 1, Juin: 1, Bin: 1, Dennis: 1, Yan: 1 }
        },
        {
          id: "demo-exp-2",
          description: "Car rental & Fuel",
          amount: 240,
          date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
          category: "transport",
          paidBy: "ED",
          splitType: "equal",
          splits: { Ban: 1, ED: 1, Juin: 1, Bin: 1, Dennis: 1, Yan: 1 }
        },
        {
          id: "demo-exp-3",
          description: "Seafood Feast Dinner",
          amount: 360,
          date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
          category: "meals",
          paidBy: "Juin",
          splitType: "equal",
          splits: { Ban: 1, ED: 1, Juin: 1, Bin: 1, Dennis: 1, Yan: 1 }
        },
        {
          id: "demo-exp-4",
          description: "Theme park tickets (Yan didn't join)",
          amount: 250,
          date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
          category: "entertainment",
          paidBy: "Bin",
          splitType: "equal",
          splits: { Ban: 1, ED: 1, Juin: 1, Bin: 1, Dennis: 1 } // Yan excluded
        },
        {
          id: "demo-exp-5",
          description: "Starbucks coffee round",
          amount: 90,
          date: new Date().toISOString().substring(0, 10),
          category: "meals",
          paidBy: "Dennis",
          splitType: "exact",
          splits: { Ban: 15, ED: 15, Juin: 15, Bin: 15, Dennis: 15, Yan: 15 }
        },
        {
          id: "demo-exp-6",
          description: "Custom Snacks & Drinks",
          amount: 120,
          date: new Date().toISOString().substring(0, 10),
          category: "groceries",
          paidBy: "Yan",
          splitType: "shares",
          splits: { Ban: 2, ED: 2, Juin: 1, Bin: 1, Dennis: 1, Yan: 1 } // Ban and ED consume double shares
        }
      ],
      settlements: [
        {
          id: "demo-set-1",
          payer: "ED",
          recipient: "Ban",
          amount: 100,
          date: new Date().toISOString().substring(0, 10)
        }
      ],
      updatedAt: Date.now()
    };

    if (isFirebaseEnabled) {
      // If Cloud sync is active, upload to Firestore
      this.storage.saveGroup(demoGroup).then(() => {
        this.switchGroup(demoGroup.id);
        this.showToast("Penang Road Trip Demo loaded in the Cloud!", "success");
      });
    } else {
      // Offline local
      this.storage.saveGroup(demoGroup).then(() => {
        this.switchGroup(demoGroup.id);
        this.showToast("Penang Road Trip Demo loaded locally!", "success");
      });
    }
  }

  // --- Helper notifications ---

  showToast(message, type = "success", actionText = null, actionCallback = null) {
    // Tactile haptic feedback on updates (12ms for success, 30ms for errors)
    if (type === "success") {
      this.vibrate(12);
    } else if (type === "error" || type === "warning") {
      this.vibrate(30);
    } else {
      this.vibrate(15);
    }

    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    
    const icon = type === "success" ? "✅" : "⚠️";
    
    let actionHtml = "";
    if (actionText && actionCallback) {
      actionHtml = `<button type="button" class="action-btn-sm" style="margin-left: 0.75rem; background: var(--primary-color); border: none; color: white; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; cursor: pointer;">${actionText}</button>`;
    }
    
    toast.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span>${icon}</span>
          <span>${message}</span>
        </div>
        ${actionHtml}
      </div>
    `;
    
    if (actionText && actionCallback) {
      const btn = toast.querySelector("button");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        actionCallback();
        toast.remove();
      });
    }

    container.appendChild(toast);
    
    const duration = actionText ? 5000 : 3000;
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.animation = "slide-down-fade 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse forwards";
        setTimeout(() => toast.remove(), 300);
      }
    }, duration);
  }

  updateThemeIcons(isLight) {
    const sun = document.querySelector(".sun-icon");
    const moon = document.querySelector(".moon-icon");
    if (sun && moon) {
      if (isLight) {
        sun.style.display = "block";
        moon.style.display = "none";
      } else {
        sun.style.display = "none";
        moon.style.display = "block";
      }
    }
  }

  vibrate(duration = 15) {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      try {
        navigator.vibrate(duration);
      } catch (err) {
        // Ignore silent vibration fails
      }
    }
  }

  mapSymbolToCode(symbol) {
    const clean = (symbol || "").trim().toUpperCase();
    if (clean === "RM" || clean === "MYR") return "MYR";
    if (clean === "$" || clean === "USD") return "USD";
    if (clean === "€" || clean === "EUR") return "EUR";
    if (clean === "£" || clean === "GBP") return "GBP";
    if (clean === "SGD") return "SGD";
    if (clean === "THB" || clean === "฿") return "THB";
    if (clean === "IDR") return "IDR";
    if (clean === "VND") return "VND";
    if (clean === "PHP") return "PHP";
    if (clean === "JPY" || clean === "🇯🇵") return "JPY";
    if (clean === "AUD") return "AUD";
    return "USD"; // Default fallback
  }

  async fetchExchangeRate(fromCurrency, toCurrency) {
    this.rateCache = this.rateCache || {};
    const cacheKey = `${fromCurrency}_${toCurrency}`;
    
    // Cache rates for 1 hour to avoid rate limit / slow responses
    const cached = this.rateCache[cacheKey];
    if (cached && (Date.now() - cached.timestamp < 3600000)) {
      return cached.rate;
    }

    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/${fromCurrency}`);
      if (!res.ok) throw new Error("API network error");
      const data = await res.json();
      if (data && data.rates && data.rates[toCurrency]) {
        const rate = data.rates[toCurrency];
        this.rateCache[cacheKey] = {
          rate,
          timestamp: Date.now()
        };
        return rate;
      }
      throw new Error("Currency rate not found in API response");
    } catch (err) {
      console.error("Exchange rate API fetch failed: ", err);
      // Local static estimate fallbacks in case user is offline or API fails
      const fallbacks = {
        "SGD_MYR": 3.45, "MYR_SGD": 0.29,
        "USD_MYR": 4.65, "MYR_USD": 0.215,
        "THB_MYR": 0.13, "MYR_THB": 7.7,
        "EUR_MYR": 5.0, "MYR_EUR": 0.2,
        "GBP_MYR": 5.8, "MYR_GBP": 0.17
      };
      
      if (fallbacks[cacheKey]) return fallbacks[cacheKey];
      if (fallbacks[`${toCurrency}_${fromCurrency}`]) return 1 / fallbacks[`${toCurrency}_${fromCurrency}`];
      return 1.0;
    }
  }

  async calculateForeignCurrency() {
    const toggle = document.getElementById("expense-convert-currency-toggle");
    const section = document.getElementById("currency-converter-section");
    if (!toggle || !section) return;

    if (!toggle.checked) {
      section.style.display = "none";
      return;
    }

    section.style.display = "flex";
    const foreignCurrency = document.getElementById("expense-foreign-currency").value;
    const foreignAmount = parseFloat(document.getElementById("expense-foreign-amount").value) || 0;
    const baseCurrencySymbol = this.activeGroup ? this.activeGroup.currency : "RM";
    const baseCurrencyCode = this.mapSymbolToCode(baseCurrencySymbol);
    
    const rateDisplay = document.getElementById("exchange-rate-value");
    const previewDisplay = document.getElementById("converted-amount-preview");
    const mainAmountInput = document.getElementById("expense-amount");

    if (foreignAmount <= 0) {
      rateDisplay.textContent = "-";
      previewDisplay.textContent = "-";
      return;
    }

    rateDisplay.textContent = "Fetching...";
    const rate = await this.fetchExchangeRate(foreignCurrency, baseCurrencyCode);
    const converted = foreignAmount * rate;

    rateDisplay.textContent = `1 ${foreignCurrency} = ${rate.toFixed(4)} ${baseCurrencyCode}`;
    previewDisplay.textContent = `${baseCurrencySymbol}${converted.toFixed(2)}`;
    
    // Update main input value
    mainAmountInput.value = converted.toFixed(2);
    
    // Trigger split values redraw
    this.renderSplitFormInputs();
  }

  exportLedgerToCSV() {
    this.vibrate(15);
    if (!this.activeGroup || !this.activeGroup.expenses || this.activeGroup.expenses.length === 0) {
      this.showToast("No expenses to export!", "warning");
      return;
    }

    const headers = ["Date", "Description", "Category", "Amount", "Paid By", "Split Method", "Split Details"];
    const rows = this.activeGroup.expenses.map(exp => {
      // Escape strings containing quotes or commas
      const desc = `"${exp.description.replace(/"/g, '""')}"`;
      const cat = exp.category;
      const amt = exp.amount.toFixed(2);
      const paidBy = exp.paidBy;
      const method = exp.splitType;
      const date = exp.date;
      
      // Split shares detailed string format: "Ban: RM10.00, ED: RM20.00"
      let splitDetails = "";
      if (exp.shares) {
        splitDetails = Object.entries(exp.shares)
          .map(([mem, share]) => `${mem}: ${this.activeGroup.currency}${parseFloat(share).toFixed(2)}`)
          .join(" | ");
      }
      const splitDetailsEscaped = `"${splitDetails.replace(/"/g, '""')}"`;

      return [date, desc, cat, amt, paidBy, method, splitDetailsEscaped];
    });

    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${this.activeGroup.name || "Group"}_Ledger.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async saveReceiptImage(expenseId, base64Data) {
    if (!this.activeGroup) return;
    const groupId = this.activeGroup.id;
    if (this.storage instanceof LocalStorageAdapter) {
      localStorage.setItem(`fairshare_receipt_${groupId}_${expenseId}`, base64Data);
    } else {
      try {
        const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        const docRef = doc(this.storage.db, "fairshare_groups", groupId, "receipts", expenseId);
        await setDoc(docRef, { image: base64Data, updatedAt: Date.now() });
      } catch (err) {
        console.error("Firestore save receipt error:", err);
      }
    }
  }

  async getReceiptImage(expenseId) {
    if (!this.activeGroup) return null;
    const groupId = this.activeGroup.id;
    if (this.storage instanceof LocalStorageAdapter) {
      return localStorage.getItem(`fairshare_receipt_${groupId}_${expenseId}`);
    } else {
      try {
        const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        const docRef = doc(this.storage.db, "fairshare_groups", groupId, "receipts", expenseId);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          return snap.data().image;
        }
      } catch (err) {
        console.error("Firestore get receipt error:", err);
      }
      return null;
    }
  }

  async deleteReceiptImage(expenseId) {
    if (!this.activeGroup) return;
    const groupId = this.activeGroup.id;
    if (this.storage instanceof LocalStorageAdapter) {
      localStorage.removeItem(`fairshare_receipt_${groupId}_${expenseId}`);
    } else {
      try {
        const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        const docRef = doc(this.storage.db, "fairshare_groups", groupId, "receipts", expenseId);
        await deleteDoc(docRef);
      } catch (err) {
        console.error("Firestore delete receipt error:", err);
      }
    }
  }

  async resetAllGroupRecords() {
    if (!this.activeGroup) return;
    const groupName = this.activeGroup.name;

    if (!confirm(`ARE YOU ABSOLUTELY SURE?\n\nThis will permanently delete ALL expenses, settlements, receipt photos, and activity history for "${groupName}".\n\nMembers list and group settings will be kept. This action cannot be undone.`)) {
      return;
    }

    // Delete all attached receipt subcollection documents safely
    if (this.activeGroup.receiptList && this.activeGroup.receiptList.length > 0) {
      for (const item of this.activeGroup.receiptList) {
        try {
          await this.deleteReceiptImage(item.expenseId);
        } catch (e) {
          console.warn("Receipt subdoc cleanup skipped:", e);
        }
      }
    }

    this.activeGroup.expenses = [];
    this.activeGroup.settlements = [];
    this.activeGroup.activities = [];
    this.activeGroup.receiptList = [];

    this.logActivity(`reset all group transaction records`, false);
    await this.triggerStateSave();
    
    this.exitBatchSelectionMode();
    this.showToast(`All records for "${groupName}" have been reset!`, "success");
    
    const dialog = document.getElementById("reset-records-dialog");
    if (dialog) dialog.close();
    const groupDialog = document.getElementById("group-dialog");
    if (groupDialog) groupDialog.close();
  }

  async clearSettlementsOnly() {
    if (!this.activeGroup) return;
    if (!this.activeGroup.settlements || this.activeGroup.settlements.length === 0) {
      this.showToast("No settlements to clear!", "info");
      return;
    }

    if (!confirm("Clear all settled payment records? Bill expenses will remain untouched.")) {
      return;
    }

    this.activeGroup.settlements = [];
    this.logActivity("cleared all payment settlements history", false);
    await this.triggerStateSave();
    this.showToast("Settlement records cleared!", "success");

    const dialog = document.getElementById("reset-records-dialog");
    if (dialog) dialog.close();
  }

  toggleBatchSelectionMode(enabled) {
    this.isBatchSelectionMode = enabled;
    this.selectedExpenseIds.clear();
    
    const bar = document.getElementById("batch-action-bar");
    if (bar) {
      bar.style.display = enabled ? "flex" : "none";
    }
    
    this.updateBatchSelectionCount();
    this.renderDashboard();
    
    const dialog = document.getElementById("reset-records-dialog");
    if (dialog && enabled) dialog.close();
  }

  exitBatchSelectionMode() {
    this.toggleBatchSelectionMode(false);
  }

  updateBatchSelectionCount() {
    const countSpan = document.getElementById("batch-selected-count");
    if (countSpan) {
      countSpan.textContent = `${this.selectedExpenseIds.size} Selected`;
    }
  }

  async deleteSelectedExpenses() {
    if (this.selectedExpenseIds.size === 0) {
      this.showToast("No expenses selected!", "warning");
      return;
    }

    const count = this.selectedExpenseIds.size;
    if (!confirm(`Delete the ${count} selected expense(s)? This action cannot be undone.`)) {
      return;
    }

    for (const id of this.selectedExpenseIds) {
      const exp = this.activeGroup.expenses.find(e => e.id === id);
      if (exp && exp.hasReceipt) {
        await this.deleteReceiptImage(id);
      }
    }

    this.activeGroup.expenses = this.activeGroup.expenses.filter(e => !this.selectedExpenseIds.has(e.id));
    if (this.activeGroup.receiptList) {
      this.activeGroup.receiptList = this.activeGroup.receiptList.filter(item => !this.selectedExpenseIds.has(item.expenseId));
    }

    this.logActivity(`deleted ${count} selected expense(s) in bulk`, false);
    await this.triggerStateSave();
    this.showToast(`Deleted ${count} expense(s).`, "success");

    this.exitBatchSelectionMode();
  }

  switchTab(tabName) {
    this.vibrate(10);
    this.activeTab = tabName;

    // Desktop Tab Buttons
    const tabExpenses = document.getElementById("tab-btn-expenses");
    const tabBalances = document.getElementById("tab-btn-balances");
    const tabActivity = document.getElementById("tab-btn-activity");
    const tabNotes = document.getElementById("tab-btn-notes");
    const tabManage = document.getElementById("tab-btn-manage");
    
    // Tab Contents
    const contentExpenses = document.getElementById("tab-content-expenses");
    const contentBalances = document.getElementById("tab-content-balances");
    const contentActivity = document.getElementById("tab-content-activity");
    const contentNotes = document.getElementById("tab-content-notes");
    const contentManage = document.getElementById("tab-content-manage");

    const tabsMap = {
      expenses: { btn: tabExpenses, content: contentExpenses },
      balances: { btn: tabBalances, content: contentBalances },
      activity: { btn: tabActivity, content: contentActivity },
      notes: { btn: tabNotes, content: contentNotes },
      manage: { btn: tabManage, content: contentManage }
    };

    Object.keys(tabsMap).forEach(key => {
      const item = tabsMap[key];
      if (item.btn) {
        if (key === tabName) item.btn.classList.add("active");
        else item.btn.classList.remove("active");
      }
      if (item.content) {
        if (key === tabName) item.content.classList.add("active");
        else item.content.classList.remove("active");
      }
    });

    // Mobile Bottom Nav Items Sync
    document.querySelectorAll(".mobile-nav-item[data-tab]").forEach(navItem => {
      if (navItem.getAttribute("data-tab") === tabName) {
        navItem.classList.add("active");
      } else {
        navItem.classList.remove("active");
      }
    });

    if (tabName === "activity") {
      this.renderActivityFeed();
    } else if (tabName === "notes") {
      this.renderNotesWall();
    } else if (tabName === "manage") {
      this.populatePageGroupSettings();
    }
  }

  populatePageGroupSettings() {
    const nameInput = document.getElementById("page-group-name-input");
    const currencySelect = document.getElementById("page-group-currency-input");
    const list = document.getElementById("page-group-members-list");

    if (!nameInput || !currencySelect || !list || !this.activeGroup) return;

    nameInput.value = this.activeGroup.name;
    currencySelect.value = this.activeGroup.currency;
    
    list.innerHTML = "";
    
    // Check which members are referenced in expenses or settlements
    const lockedMembers = new Set();
    if (this.activeGroup.expenses) {
      this.activeGroup.expenses.forEach(e => {
        lockedMembers.add(e.paidBy);
        if (e.splits) Object.keys(e.splits).forEach(m => lockedMembers.add(m));
      });
    }
    if (this.activeGroup.settlements) {
      this.activeGroup.settlements.forEach(s => {
        lockedMembers.add(s.payer);
        lockedMembers.add(s.recipient);
      });
    }

    this.activeGroup.members.forEach(m => {
      const row = document.createElement("div");
      row.className = "split-member-row";
      
      const isLocked = lockedMembers.has(m);
      const actionHtml = isLocked 
        ? `<span style="font-size:0.75rem; color:var(--text-muted);">locked (has bills)</span>`
        : `<button type="button" class="action-btn-sm btn-remove-member-page" data-member="${m}" style="color:var(--danger-color);">Remove</button>`;

      row.innerHTML = `
        <div style="font-weight: 500;">${m}</div>
        <div>${actionHtml}</div>
      `;

      if (!isLocked) {
        row.querySelector(".btn-remove-member-page").addEventListener("click", () => {
          this.activeGroup.members = this.activeGroup.members.filter(mem => mem !== m);
          this.populatePageGroupSettings();
        });
      }

      list.appendChild(row);
    });
  }

  openGroupSettingsModal() {
    this.populateGroupSettingsForm();
    document.getElementById("group-dialog").showModal();
  }

  // --- Event Listeners Binder ---

  setupEventListeners() {
    // 1. Group Selector
    document.getElementById("group-select").addEventListener("change", (e) => {
      this.switchGroup(e.target.value);
    });

    // 2. Active User Selector
    const userSelect = document.getElementById("user-select");
    if (userSelect) {
      userSelect.addEventListener("change", (e) => {
        const chosen = e.target.value;
        if (!chosen) return;
        this.currentUser = chosen;
        localStorage.setItem("fairshare_my_name", chosen);
        this.updateGroupSelects();
        this.renderDashboard();
      });
    }

    // 3. Theme Toggle
    document.getElementById("theme-toggle").addEventListener("click", () => {
      const isLight = document.body.classList.toggle("light-theme");
      localStorage.setItem("fairshare_theme", isLight ? "light" : "dark");
      this.updateThemeIcons(isLight);
    });
    
    // 4. Tab Navigation (Desktop & Mobile Nav)
    const tabExpenses = document.getElementById("tab-btn-expenses");
    const tabBalances = document.getElementById("tab-btn-balances");
    const tabActivity = document.getElementById("tab-btn-activity");
    const tabNotes = document.getElementById("tab-btn-notes");

    const tabManage = document.getElementById("tab-btn-manage");

    if (tabExpenses) tabExpenses.addEventListener("click", () => this.switchTab("expenses"));
    if (tabBalances) tabBalances.addEventListener("click", () => this.switchTab("balances"));
    if (tabActivity) tabActivity.addEventListener("click", () => this.switchTab("activity"));
    if (tabNotes) tabNotes.addEventListener("click", () => this.switchTab("notes"));
    if (tabManage) tabManage.addEventListener("click", () => this.switchTab("manage"));

    // Mobile Bottom Navigation items
    document.querySelectorAll(".mobile-nav-item[data-tab]").forEach(navBtn => {
      navBtn.addEventListener("click", () => {
        const tab = navBtn.getAttribute("data-tab");
        this.switchTab(tab);
      });
    });

    const bnavManage = document.getElementById("bnav-manage");
    if (bnavManage) {
      bnavManage.addEventListener("click", () => {
        this.vibrate(10);
        this.switchTab("manage");
      });
    }

    // Page Manage Group Form Submit
    const pageGroupForm = document.getElementById("page-group-form");
    if (pageGroupForm) {
      pageGroupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const newName = document.getElementById("page-group-name-input").value.trim();
        const newCurrency = document.getElementById("page-group-currency-input").value;
        if (!newName) return;

        this.activeGroup.name = newName;
        this.activeGroup.currency = newCurrency;
        this.logActivity(`updated group name to "${newName}" (${newCurrency})`, false);
        await this.triggerStateSave();
        this.renderDashboard();
        this.showToast("Group settings saved!", "success");
      });
    }

    // Page Add Member button
    const pageBtnAddMember = document.getElementById("page-btn-add-member-item");
    if (pageBtnAddMember) {
      pageBtnAddMember.addEventListener("click", () => {
        const input = document.getElementById("page-new-member-name");
        const name = input ? input.value.trim() : "";
        if (!name) return;
        if (this.activeGroup.members.includes(name)) {
          this.showToast(`"${name}" is already in the group!`, "warning");
          return;
        }
        this.activeGroup.members.push(name);
        if (input) input.value = "";
        this.populatePageGroupSettings();
      });
    }

    // Page Group Actions
    const pageBtnCreate = document.getElementById("page-btn-create-new-group");
    if (pageBtnCreate) {
      pageBtnCreate.addEventListener("click", () => this.createNewGroup());
    }

    const pageBtnReset = document.getElementById("page-btn-reset-group-records");
    if (pageBtnReset) {
      pageBtnReset.addEventListener("click", () => {
        this.vibrate(10);
        const modal = document.getElementById("reset-records-dialog");
        if (modal) modal.showModal();
      });
    }

    const pageBtnDelete = document.getElementById("page-btn-delete-active-group");
    if (pageBtnDelete) {
      pageBtnDelete.addEventListener("click", () => this.deleteActiveGroup());
    }

    // Mobile FAB Add Expense Button
    const fabAdd = document.getElementById("fab-add-expense");
    if (fabAdd) {
      fabAdd.addEventListener("click", () => {
        this.vibrate(15);
        this.openExpenseForm();
      });
    }

    // 5. Search and Filters
    document.getElementById("expense-search").addEventListener("input", () => this.renderDashboard());
    document.getElementById("expense-filter-category").addEventListener("change", () => this.renderDashboard());

    // Export Ledger CSV Action
    const btnExport = document.getElementById("btn-export-ledger");
    if (btnExport) {
      btnExport.addEventListener("click", () => this.exportLedgerToCSV());
    }

    // Reset / Purge Records Modal & Actions
    const btnOpenReset = document.getElementById("btn-open-reset-dialog");
    if (btnOpenReset) {
      btnOpenReset.addEventListener("click", () => {
        this.vibrate(10);
        const modal = document.getElementById("reset-records-dialog");
        if (modal) modal.showModal();
      });
    }

    const btnResetInGroupModal = document.getElementById("btn-reset-group-records");
    if (btnResetInGroupModal) {
      btnResetInGroupModal.addEventListener("click", () => {
        this.vibrate(10);
        const modal = document.getElementById("reset-records-dialog");
        if (modal) modal.showModal();
      });
    }

    const btnResetAll = document.getElementById("btn-action-reset-all");
    if (btnResetAll) {
      btnResetAll.addEventListener("click", () => this.resetAllGroupRecords());
    }

    const btnClearSettlements = document.getElementById("btn-action-clear-settlements");
    if (btnClearSettlements) {
      btnClearSettlements.addEventListener("click", () => this.clearSettlementsOnly());
    }

    const btnBatchSelect = document.getElementById("btn-action-batch-select");
    if (btnBatchSelect) {
      btnBatchSelect.addEventListener("click", () => this.toggleBatchSelectionMode(true));
    }

    const btnCancelBatch = document.getElementById("btn-cancel-batch");
    if (btnCancelBatch) {
      btnCancelBatch.addEventListener("click", () => this.exitBatchSelectionMode());
    }

    const btnDeleteBatch = document.getElementById("btn-delete-selected-batch");
    if (btnDeleteBatch) {
      btnDeleteBatch.addEventListener("click", () => this.deleteSelectedExpenses());
    }

    // Quick Filter Pills Event Listeners
    const filterPills = document.querySelectorAll(".filter-pill");
    filterPills.forEach(pill => {
      pill.addEventListener("click", () => {
        this.vibrate(10);
        filterPills.forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
        this.activeFilterPill = pill.getAttribute("data-filter");
        this.renderDashboard();
      });
    });

    // Currency Converter Interactive Elements
    const converterToggle = document.getElementById("expense-convert-currency-toggle");
    if (converterToggle) {
      converterToggle.addEventListener("change", () => {
        this.vibrate(10);
        this.calculateForeignCurrency();
      });
    }

    const foreignCurrencySelect = document.getElementById("expense-foreign-currency");
    if (foreignCurrencySelect) {
      foreignCurrencySelect.addEventListener("change", () => {
        this.vibrate(10);
        this.calculateForeignCurrency();
      });
    }

    const foreignAmountInput = document.getElementById("expense-foreign-amount");
    if (foreignAmountInput) {
      foreignAmountInput.addEventListener("input", () => {
        this.calculateForeignCurrency();
      });
    }

    // 6. Expense Modal triggers
    document.getElementById("btn-open-expense-dialog").addEventListener("click", () => this.openExpenseForm());
    
    // Split Type Radio Button Changes
    document.querySelectorAll('input[name="split-type"]').forEach(radio => {
      radio.addEventListener("change", () => {
        this.renderSplitFormInputs();
      });
    });

    // 7. Add Expense Form Submission
    document.getElementById("expense-form").addEventListener("submit", (e) => {
      e.preventDefault();
      
      const id = document.getElementById("expense-id-input").value;
      const description = document.getElementById("expense-desc").value;
      const amount = parseFloat(document.getElementById("expense-amount").value);
      const date = document.getElementById("expense-date").value;
      const paidBy = document.getElementById("expense-paid-by").value;
      const category = document.querySelector('input[name="expense-category"]:checked').value;
      const splitType = document.querySelector('input[name="split-type"]:checked').value;

      // Extract splits values
      const splits = {};
      
      if (splitType === "equal") {
        document.querySelectorAll(".split-member-chk").forEach(chk => {
          if (chk.checked) {
            splits[chk.getAttribute("data-member")] = 1;
          }
        });
      } else {
        document.querySelectorAll(".split-member-input").forEach(input => {
          const val = parseFloat(input.value) || 0;
          if (val > 0) {
            splits[input.getAttribute("data-member")] = val;
          }
        });
      }

      const expenseObj = {
        description,
        amount,
        date,
        paidBy,
        category,
        splitType,
        splits
      };

      if (id) {
        // Edit Mode
        this.updateExpense(id, expenseObj);
      } else {
        // Add Mode
        expenseObj.id = "exp_" + generateUUID();
        this.addExpense(expenseObj);
      }

      document.getElementById("expense-dialog").close();
    });

    // 8. Settle Up Dialog triggers
    document.getElementById("settle-form").addEventListener("submit", (e) => {
      e.preventDefault();
      
      const payer = document.getElementById("settle-payer").value;
      const recipient = document.getElementById("settle-recipient").value;
      const amount = parseFloat(document.getElementById("settle-amount").value);
      
      if (payer === recipient) {
        this.showToast("Payer and Recipient must be different members!", "error");
        return;
      }

      const settlementObj = {
        id: "set_" + generateUUID(),
        payer,
        recipient,
        amount,
        date: new Date().toISOString().substring(0, 10),
        receipt: this.settleReceiptDataUrl || ""
      };

      this.addSettlement(settlementObj);
      document.getElementById("settle-dialog").close();
    });

    // 9. Manage Group triggers
    document.getElementById("btn-open-group-dialog").addEventListener("click", () => this.openGroupSettings());
    
    // Add Member to Group dialog
    document.getElementById("btn-add-member-item").addEventListener("click", () => {
      const nameInput = document.getElementById("new-member-name");
      const name = nameInput.value.trim();
      if (!name) return;
      
      if (this.activeGroup.members.includes(name)) {
        this.showToast("Member name already exists in the group!", "error");
        return;
      }
      
      this.activeGroup.members.push(name);
      
      // Initialize bank details entry for the newly added member
      this.activeGroup.bankDetails = this.activeGroup.bankDetails || {};
      this.activeGroup.bankDetails[name] = {
        bankName: "",
        accountNumber: "",
        fullName: name,
        qrCode: ""
      };
      
      nameInput.value = "";
      this.openGroupSettings(); // Refresh
    });

    // Group settings save submission
    document.getElementById("group-form").addEventListener("submit", (e) => {
      e.preventDefault();
      
      const newName = document.getElementById("group-name-input").value.trim();
      const newCurrency = document.getElementById("group-currency-input").value;
      
      if (newName) {
        this.activeGroup.name = newName;
      }
      this.activeGroup.currency = newCurrency;
      
      this.triggerStateSave().then(() => {
        this.updateGroupSelects();
        this.showToast("Group settings saved.", "success");
      });
      
      document.getElementById("group-dialog").close();
    });

    // Brand new group creation button
    document.getElementById("btn-create-new-group").addEventListener("click", async () => {
      const name = prompt("Enter a name for the new group:", "Trip Expenses");
      if (!name) return;
      
      const newGroup = await this.storage.createGroup(name.trim(), "$", ["Ban", "ED", "Juin", "Bin", "Dennis", "Yan"]);
      document.getElementById("group-dialog").close();
      this.switchGroup(newGroup.id);
      this.showToast(`Group "${name}" created!`, "success");
    });

    // 10. Copy Share URL
    document.getElementById("btn-copy-share-url").addEventListener("click", () => {
      const urlText = document.getElementById("share-url-text").textContent;
      navigator.clipboard.writeText(urlText)
        .then(() => this.showToast("Link copied to clipboard!", "success"))
        .catch(() => this.showToast("Failed to copy link.", "error"));
    });

    // 11. Cloud sync tutorial badge trigger
    document.getElementById("sync-status-badge").addEventListener("click", () => {
      document.getElementById("cloud-setup-dialog").showModal();
    });

    // 12. Delete Active Group
    document.getElementById("btn-delete-active-group").addEventListener("click", async () => {
      const groupName = this.activeGroup.name;
      const groupId = this.activeGroup.id;
      
      if (confirm(`Are you sure you want to permanently delete the group "${groupName}"? This action cannot be undone.`)) {
        try {
          await this.storage.deleteGroup(groupId);
          this.showToast(`Group "${groupName}" deleted.`, "success");
          document.getElementById("group-dialog").close();
          
          // Switch back to default-group
          this.switchGroup("default-group");
        } catch (err) {
          console.error("Failed to delete group:", err);
          this.showToast("Delete failed: " + err.message, "error");
        }
      }
    });

    // 13. Bank details modal listeners
    const btnToggleEdit = document.getElementById("btn-toggle-bank-edit");
    const btnCancelEdit = document.getElementById("btn-cancel-bank-edit");
    const bankViewSection = document.getElementById("bank-details-view");
    const bankEditForm = document.getElementById("bank-details-form");
    
    btnToggleEdit.addEventListener("click", () => {
      bankViewSection.style.display = "none";
      bankEditForm.style.display = "flex";
    });
    
    btnCancelEdit.addEventListener("click", () => {
      bankViewSection.style.display = "flex";
      bankEditForm.style.display = "none";
    });
    
    bankEditForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const member = document.getElementById("bank-member-name").value;
      const bankName = document.getElementById("bank-input-name").value.trim();
      const accountNumber = document.getElementById("bank-input-acct").value.trim();
      const fullName = document.getElementById("bank-input-holder").value.trim();
      const duitnowId = document.getElementById("bank-input-duitnow").value.trim();
      const duitnowType = document.getElementById("bank-input-duitnow-type").value;
      
      this.activeGroup.bankDetails = this.activeGroup.bankDetails || {};
      this.activeGroup.bankDetails[member] = { 
        bankName, 
        accountNumber, 
        fullName, 
        qrCode: this.editingQrDataUrl || "",
        duitnowId,
        duitnowType
      };
      this.logActivity(`updated bank account details for ${member}`, false);
      
      try {
        await this.triggerStateSave();
        console.log("State saved successfully.");
        this.showToast(`Saved bank details for ${member}`, "success");
        document.getElementById("member-bank-dialog").close();
      } catch (err) {
        console.error("Failed to save bank details:", err);
        this.showToast("Save failed: " + err.message, "error");
      }
    });
    
    document.getElementById("btn-copy-bank-acct").addEventListener("click", () => {
      const acct = document.getElementById("bank-view-acct").textContent;
      if (acct && acct !== "—") {
        navigator.clipboard.writeText(acct)
          .then(() => this.showToast("Account number copied!", "success"))
          .catch(() => this.showToast("Failed to copy.", "error"));
      }
    });

    document.getElementById("btn-copy-bank-holder").addEventListener("click", () => {
      const name = document.getElementById("bank-view-holder").textContent;
      if (name && name !== "-") {
        navigator.clipboard.writeText(name)
          .then(() => this.showToast("Account holder name copied!", "success"))
          .catch(() => this.showToast("Failed to copy.", "error"));
      }
    });

    document.getElementById("btn-copy-bank-duitnow").addEventListener("click", () => {
      const id = document.getElementById("bank-view-duitnow").textContent;
      if (id && id !== "—") {
        navigator.clipboard.writeText(id)
          .then(() => this.showToast("DuitNow ID copied!", "success"))
          .catch(() => this.showToast("Failed to copy.", "error"));
      }
    });

    document.getElementById("btn-copy-settle-acct").addEventListener("click", () => {
      const acct = document.getElementById("settle-bank-acct").textContent;
      if (acct && acct !== "-") {
        navigator.clipboard.writeText(acct)
          .then(() => this.showToast("Account number copied!", "success"))
          .catch(() => this.showToast("Failed to copy.", "error"));
      }
    });

    document.getElementById("btn-copy-settle-holder").addEventListener("click", () => {
      const name = document.getElementById("settle-bank-holder").textContent;
      if (name && name !== "-") {
        navigator.clipboard.writeText(name)
          .then(() => this.showToast("Account name copied!", "success"))
          .catch(() => this.showToast("Failed to copy name.", "error"));
      }
    });

    // Select All split checklist helper
    document.getElementById("btn-split-select-all").addEventListener("click", () => {
      const checkboxes = document.querySelectorAll(".split-member-chk");
      checkboxes.forEach(chk => {
        if (!chk.checked) {
          chk.checked = true;
          chk.dispatchEvent(new Event("change"));
        }
      });
    });

    // Clear All split checklist helper
    document.getElementById("btn-split-clear-all").addEventListener("click", () => {
      const checkboxes = document.querySelectorAll(".split-member-chk");
      checkboxes.forEach(chk => {
        if (chk.checked) {
          chk.checked = false;
          chk.dispatchEvent(new Event("change"));
        }
      });
    });

    // Drag-and-drop elements
    const dropZone = document.getElementById("qr-drop-zone");
    
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    });

    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("dragover");
    });

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) {
        this.processQrImageFile(file);
      } else {
        this.showToast("Only image files are allowed for QR codes.", "error");
      }
    });

    // Paste event handler
    document.addEventListener("paste", (e) => {
      const form = document.getElementById("bank-details-form");
      if (form && form.style.display !== "none") {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (const item of items) {
          if (item.kind === "file" && item.type.startsWith("image/")) {
            const file = item.getAsFile();
            this.processQrImageFile(file);
            this.showToast("QR code image pasted successfully!", "success");
            e.preventDefault();
          }
        }
      }
    });

    document.getElementById("settle-recipient").addEventListener("change", () => {
      const rec = document.getElementById("settle-recipient").value;
      const bankPanel = document.getElementById("settle-bank-details");
      const qrPanel = document.getElementById("settle-qr-container");
      this.activeGroup.bankDetails = this.activeGroup.bankDetails || {};
      const det = this.activeGroup.bankDetails[rec];
      
      if (det && det.accountNumber) {
        document.getElementById("settle-bank-name").textContent = det.bankName;
        document.getElementById("settle-bank-acct").textContent = det.accountNumber;
        document.getElementById("settle-bank-holder").textContent = det.fullName;
        bankPanel.style.display = "block";
        
        if (det.qrCode) {
          document.getElementById("settle-qr-img").src = det.qrCode;
          qrPanel.style.display = "flex";
        } else {
          qrPanel.style.display = "none";
        }
      } else {
        bankPanel.style.display = "none";
        qrPanel.style.display = "none";
      }
    });

    // 14. QR Code Upload & Removal Listeners
    document.getElementById("bank-input-qr").addEventListener("change", (e) => {
      const file = e.target.files[0];
      this.processQrImageFile(file);
    });

    // 16. Settle up receipt upload zone drag/drop & paste
    const receiptDropZone = document.getElementById("settle-receipt-drop-zone");
    
    receiptDropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      receiptDropZone.classList.add("dragover");
    });

    receiptDropZone.addEventListener("dragleave", () => {
      receiptDropZone.classList.remove("dragover");
    });

    receiptDropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      receiptDropZone.classList.remove("dragover");
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) {
        this.processSettleReceiptFile(file);
      } else {
        this.showToast("Only image files are allowed for receipts.", "error");
      }
    });

    // Paste event handler for receipt upload
    document.addEventListener("paste", (e) => {
      const dialog = document.getElementById("settle-dialog");
      if (dialog && dialog.open) {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (const item of items) {
          if (item.kind === "file" && item.type.startsWith("image/")) {
            const file = item.getAsFile();
            this.processSettleReceiptFile(file);
            this.showToast("Receipt image pasted successfully!", "success");
            e.preventDefault();
          }
        }
      }
    });

    document.getElementById("settle-input-receipt").addEventListener("change", (e) => {
      const file = e.target.files[0];
      this.processSettleReceiptFile(file);
    });

    document.getElementById("btn-remove-settle-receipt").addEventListener("click", () => {
      console.log("Removing receipt image");
      this.settleReceiptDataUrl = "";
      document.getElementById("settle-input-receipt").value = "";
      document.getElementById("settle-receipt-preview").src = "";
      document.getElementById("settle-receipt-preview-container").style.display = "none";
    });

    // 17. Lightbox triggers
    document.getElementById("btn-close-lightbox").addEventListener("click", () => {
      this.vibrate(10);
      document.getElementById("receipt-lightbox-dialog").close();
    });

    document.getElementById("receipt-lightbox-dialog").addEventListener("click", (e) => {
      const lightbox = document.getElementById("receipt-lightbox-dialog");
      if (e.target === lightbox) {
        this.vibrate(10);
        lightbox.close();
      }
    });

    // 18. Toggle spending charts collapsible panel
    document.getElementById("btn-toggle-analytics").addEventListener("click", () => {
      const panel = document.getElementById("analytics-panel");
      const isVisible = panel.style.display === "block";
      panel.style.display = isVisible ? "none" : "block";
      
      if (!isVisible) {
        this.renderAnalytics();
      }
    });

    // 19. Autocomplete/Suggestions logic
    const descInput = document.getElementById("expense-desc");
    const suggestionsContainer = document.getElementById("expense-desc-suggestions");

    const AUTO_CATEGORIES = {
      meals: ["dinner", "lunch", "breakfast", "mcd", "starbucks", "food", "cafe", "restaurant", "eat", "drink", "beer", "sushi", "kfc", "mamak", "cafe", "coffee", "supper"],
      transport: ["taxi", "grab", "flight", "petrol", "fuel", "train", "toll", "parking", "car", "ride", "ticket", "petronas", "shell", "toll", "flight", "plane", "airline"],
      lodging: ["hotel", "airbnb", "stay", "hostel", "resort", "homestay"],
      groceries: ["grocery", "groceries", "supermarket", "aeon", "jaya", "lotus", "market", "cooking", "tesco"],
      entertainment: ["movie", "cinema", "netflix", "karaoke", "concert", "game", "ktv", "ticket", "show"],
      utilities: ["bill", "electricity", "water", "wifi", "internet", "phone", "tnb", "unifi", "maxis", "celcom", "digi"]
    };

    descInput.addEventListener("input", (e) => {
      const text = e.target.value.toLowerCase().trim();
      suggestionsContainer.innerHTML = "";
      suggestionsContainer.style.display = "none";

      if (text.length < 2) return;

      // 1. Detect Category automatically based on keywords
      let matchedCategory = null;
      for (const [cat, keywords] of Object.entries(AUTO_CATEGORIES)) {
        if (keywords.some(kw => text.includes(kw))) {
          matchedCategory = cat;
          break;
        }
      }

      if (matchedCategory) {
        const radio = document.querySelector(`input[name="expense-category"][value="${matchedCategory}"]`);
        if (radio && !radio.checked) {
          radio.checked = true;
        }
      }

      // 2. Provide Quick Autocomplete suggestion pills
      const suggestionsList = [
        { label: "Lunch 🍔", desc: "Lunch", cat: "meals" },
        { label: "Dinner 🍔", desc: "Dinner", cat: "meals" },
        { label: "Coffee ☕", desc: "Coffee", cat: "meals" },
        { label: "Grab 🚗", desc: "Grab Ride", cat: "transport" },
        { label: "Petrol ⛽", desc: "Petrol", cat: "transport" },
        { label: "Toll 🚗", desc: "Toll Payment", cat: "transport" },
        { label: "Airbnb 🏨", desc: "Airbnb stay", cat: "lodging" },
        { label: "Groceries 🛒", desc: "Groceries", cat: "groceries" },
        { label: "Cinema 🍿", desc: "Movie tickets", cat: "entertainment" },
        { label: "Electricity Bill ⚡", desc: "TNB Bill", cat: "utilities" }
      ];

      const matches = suggestionsList.filter(s => s.label.toLowerCase().includes(text) || s.desc.toLowerCase().includes(text));
      if (matches.length > 0) {
        suggestionsContainer.style.display = "flex";
        matches.slice(0, 3).forEach(match => {
          const pill = document.createElement("button");
          pill.type = "button";
          pill.className = "action-btn-sm";
          pill.style = "padding: 0.2rem 0.5rem; font-size: 0.75rem; border-radius: 20px; border: 1px solid var(--surface-border); background: rgba(255,255,255,0.03); color: var(--text-secondary); cursor: pointer;";
          pill.textContent = match.label;
          pill.addEventListener("click", () => {
            descInput.value = match.desc;
            const radio = document.querySelector(`input[name="expense-category"][value="${match.cat}"]`);
            if (radio) radio.checked = true;
            suggestionsContainer.innerHTML = "";
            suggestionsContainer.style.display = "none";
          });
          suggestionsContainer.appendChild(pill);
        });
      }
    });

    // 20. Real-time Notes Wall Submissions
    document.getElementById("notes-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("note-input");
      const val = input.value.trim();
      if (val) {
        this.addNote(val);
        input.value = "";
      }
    });

    // 22. Liquid Water-Ripple coordinates tap listener
    document.addEventListener("click", (e) => {
      // Avoid ripples on inputs or standard text selects to prevent interface bugs
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") {
        return;
      }

      const ripple = document.createElement("span");
      ripple.className = "liquid-ripple";
      
      const size = 80;
      ripple.style.width = size + "px";
      ripple.style.height = size + "px";
      
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;
      
      ripple.style.left = (e.clientX + scrollX - size/2) + "px";
      ripple.style.top = (e.clientY + scrollY - size/2) + "px";
      
      document.body.appendChild(ripple);
      
      setTimeout(() => {
        ripple.remove();
      }, 600);
    });

    // 15. Open Changelog Dialog
    const btnChangelog = document.getElementById("btn-open-changelog");
    if (btnChangelog) {
      btnChangelog.addEventListener("click", () => {
        this.vibrate(10);
        const dialog = document.getElementById("changelog-dialog");
        if (dialog) dialog.showModal();
      });
    }

    // 21. Gemini API Key Settings Form & Triggers
    const apiKeyDialog = document.getElementById("api-key-dialog");
    const btnApiSettings = document.getElementById("btn-open-api-settings");
    if (btnApiSettings && apiKeyDialog) {
      btnApiSettings.addEventListener("click", () => {
        this.vibrate(10);
        const cloudKey = this.activeGroup ? this.activeGroup.geminiApiKey : "";
        const savedKey = cloudKey || localStorage.getItem("gemini_api_key") || "";
        const inputKey = document.getElementById("input-gemini-key");
        if (inputKey) inputKey.value = savedKey;
        apiKeyDialog.showModal();
      });
    }

    document.getElementById("api-key-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const keyVal = document.getElementById("input-gemini-key").value.trim();
      if (keyVal) {
        localStorage.setItem("gemini_api_key", keyVal);
        if (this.activeGroup) {
          this.activeGroup.geminiApiKey = keyVal;
          await this.triggerStateSave();
          this.showToast("Gemini API Key saved to Cloud for this group!", "success");
        } else {
          this.showToast("Gemini API Key saved locally!", "success");
        }
      } else {
        localStorage.removeItem("gemini_api_key");
        if (this.activeGroup) {
          delete this.activeGroup.geminiApiKey;
          await this.triggerStateSave();
        }
        this.showToast("Gemini API Key removed.", "warning");
      }
      document.getElementById("api-key-dialog").close();
    });

    // 22. Real Gemini AI Scan trigger
    const scanBtn = document.getElementById("btn-scan-receipt-ai");
    const scanFileInput = document.getElementById("scan-receipt-file-input");
    
    scanBtn.addEventListener("click", () => {
      scanFileInput.click();
    });
    
    scanFileInput.addEventListener("change", async (e) => {
      let file = e.target.files[0];
      if (file) {
        if (file.type.startsWith("image/")) {
          const originalSizeKB = (file.size / 1024).toFixed(1);
          console.log(`Original image size: ${originalSizeKB} KB`);
          
          const scannerStatus = document.getElementById("scanner-status");
          const scannerOverlay = document.getElementById("scanner-overlay");
          scannerOverlay.style.display = "flex";
          scannerStatus.textContent = "Compressing Receipt Image...";
          
          try {
            file = await this.compressImage(file);
            const compressedSizeKB = (file.size / 1024).toFixed(1);
            console.log(`Compressed image size: ${compressedSizeKB} KB`);
          } catch (compressErr) {
            console.warn("Image compression failed, using original file: ", compressErr);
          } finally {
            scannerOverlay.style.display = "none";
          }
        }
        this.performGeminiScan(file);
      }
    });

    // 23. Settle Amount dynamic DuitNow QR Code listener
    document.getElementById("settle-amount").addEventListener("input", () => {
      const dialog = document.getElementById("settle-dialog");
      if (dialog && dialog.open) {
        const rec = document.getElementById("settle-recipient").value;
        const qrPanel = document.getElementById("settle-qr-container");
        this.activeGroup.bankDetails = this.activeGroup.bankDetails || {};
        const det = this.activeGroup.bankDetails[rec];
        if (det && det.accountNumber && !det.qrCode && det.duitnowId) {
          const settleAmount = document.getElementById("settle-amount").value || "0.00";
          const qrData = this.generateDuitNowEMVCo(det.duitnowType, det.duitnowId, det.fullName, settleAmount, this.activeGroup.currency);
          document.getElementById("settle-qr-img").src = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + encodeURIComponent(qrData);
          qrPanel.style.display = "flex";
        }
      }
    });

    // 24. Onboarding Form Submission
    const onboardingDialog = document.getElementById("onboarding-dialog");
    const onboardingForm = document.getElementById("onboarding-form");
    if (onboardingForm) {
      onboardingForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const selectVal = document.getElementById("onboarding-select-member").value;
        const inputVal = document.getElementById("onboarding-input-name").value.trim();
        
        let chosenName = "";
        
        if (inputVal) {
          const newName = inputVal.charAt(0).toUpperCase() + inputVal.slice(1);
          
          if (this.activeGroup.members.some(m => m.toLowerCase() === newName.toLowerCase())) {
            this.showToast(`"${newName}" is already in the group! Please choose it from the select list or use another nickname.`, "error");
            return;
          }
          
          this.activeGroup.members.push(newName);
          this.activeGroup.bankDetails = this.activeGroup.bankDetails || {};
          this.activeGroup.bankDetails[newName] = {
            bankName: "",
            accountNumber: "",
            fullName: newName,
            qrCode: ""
          };
          
          chosenName = newName;
          this.logActivity(`joined the group as a new member named ${newName}`, false);
          await this.triggerStateSave();
        } else if (selectVal) {
          chosenName = selectVal;
          this.logActivity(`joined the group as ${selectVal}`, true);
        } else {
          this.showToast("Please select an existing name OR type a nickname to join!", "error");
          return;
        }
        
        localStorage.setItem("fairshare_my_name", chosenName);
        this.currentUser = chosenName;
        
        this.updateGroupSelects();
        this.renderDashboard();
        
        onboardingDialog.close();
        this.showToast(`Welcome to SATA Split, ${chosenName}!`, "success");
      });
    }

    // 25. Offline Queue Sync Handler
    window.addEventListener("online", async () => {
      this.showToast("Network restored! Syncing offline changes...", "info");
      
      let syncedAny = false;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("fairshare_offline_queued_group_")) {
          try {
            const groupData = JSON.parse(localStorage.getItem(key));
            if (groupData && groupData.id) {
              await this.storage.saveGroup(groupData);
              localStorage.removeItem(key);
              syncedAny = true;
              console.log(`Synced offline group changes for ${groupData.id}`);
            }
          } catch (err) {
            console.error("Failed to sync offline group: ", err);
          }
        }
      }
      
      if (syncedAny) {
        this.showToast("All offline changes synced to Cloud successfully!", "success");
        this.switchGroup(this.activeGroup.id);
      }
    });

    // 26. Close dialog modals when clicking outside their card area (on the backdrop overlay)
    const dialogElements = document.querySelectorAll("dialog");
    dialogElements.forEach(dlg => {
      if (dlg.id === "onboarding-dialog") return; // Onboarding dialog is mandatory, do not dismiss on click away
      
      dlg.addEventListener("click", (e) => {
        const rect = dlg.getBoundingClientRect();
        const isInDialog = (
          rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
          rect.left <= e.clientX && e.clientX <= rect.left + rect.width
        );
        if (!isInDialog) {
          this.vibrate(10);
          dlg.close();
        }
      });
    });
  }

  processQrImageFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      console.log("FileReader loaded data URL of length:", event.target.result.length);
      const img = new Image();
      img.onload = () => {
        console.log("Image loaded, dimensions:", img.width, img.height);
        const canvas = document.createElement("canvas");
        const maxDim = 350;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        this.editingQrDataUrl = canvas.toDataURL("image/jpeg", 0.75);
        console.log("Compressed QR URL of length:", this.editingQrDataUrl.length);
        document.getElementById("bank-edit-qr-preview").src = this.editingQrDataUrl;
        document.getElementById("bank-edit-qr-preview-container").style.display = "flex";
      };
      img.onerror = (err) => {
        console.error("Image load error:", err);
      };
      img.src = event.target.result;
    };
    reader.onerror = (err) => {
      console.error("FileReader error:", err);
    };
    reader.readAsDataURL(file);
  }

  async logActivity(actionText, saveImmediately = true) {
    if (!this.activeGroup) return;
    this.activeGroup.activities = this.activeGroup.activities || [];
    
    if (this.activeGroup.activities.length >= 100) {
      this.activeGroup.activities.shift();
    }

    this.activeGroup.activities.push({
      id: "act_" + Math.random().toString(36).substring(2, 11),
      user: this.currentUser || "System",
      action: actionText,
      timestamp: Date.now()
    });

    if (saveImmediately) {
      await this.triggerStateSave();
    }
  }

  renderActivityFeed() {
    const container = document.getElementById("activity-list");
    if (!container) return;
    container.innerHTML = "";

    const activities = this.activeGroup.activities || [];
    if (activities.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="text-align: center; padding: 2rem 1rem; color: var(--text-muted);">
          <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"></path></svg>
          <p>No activity logs recorded yet in this group.</p>
        </div>
      `;
      return;
    }

    const sorted = [...activities].sort((a, b) => b.timestamp - a.timestamp);
    sorted.forEach(act => {
      const item = document.createElement("div");
      item.className = "activity-item animate-fade-in";
      
      const date = new Date(act.timestamp);
      const timeStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      item.innerHTML = `
        <div class="activity-text" style="color: var(--text-primary);">
          <span class="activity-user" style="color: var(--primary-color); font-weight: 700;">${act.user}</span> ${act.action}
        </div>
        <div class="activity-meta" style="margin-top: 0.25rem;">
          <span>${timeStr}</span>
        </div>
      `;
      container.appendChild(item);
    });
  }

  processSettleReceiptFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      console.log("FileReader loaded receipt URL of length:", event.target.result.length);
      const img = new Image();
      img.onload = () => {
        console.log("Receipt image loaded, dimensions:", img.width, img.height);
        const canvas = document.createElement("canvas");
        const maxDim = 400;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        this.settleReceiptDataUrl = canvas.toDataURL("image/jpeg", 0.7);
        console.log("Compressed receipt URL of length:", this.settleReceiptDataUrl.length);
        document.getElementById("settle-receipt-preview").src = this.settleReceiptDataUrl;
        document.getElementById("settle-receipt-preview-container").style.display = "flex";
      };
      img.onerror = (err) => {
        console.error("Receipt load error:", err);
      };
      img.src = event.target.result;
    };
    reader.onerror = (err) => {
      console.error("FileReader error:", err);
    };
    reader.readAsDataURL(file);
  }

  renderAnalytics() {
    const categoriesSum = {};
    const memberPaidSum = {};
    
    this.activeGroup.members.forEach(m => {
      memberPaidSum[m] = 0;
    });

    this.activeGroup.expenses.forEach(exp => {
      const amount = parseFloat(exp.amount) || 0;
      const cat = exp.category || "other";
      categoriesSum[cat] = (categoriesSum[cat] || 0) + amount;
      
      const payer = exp.paidBy;
      if (memberPaidSum[payer] !== undefined) {
        memberPaidSum[payer] += amount;
      }
    });

    const totalSpend = Object.values(categoriesSum).reduce((a, b) => a + b, 0);
    const donutContainer = document.getElementById("chart-donut-container");
    const legendContainer = document.getElementById("chart-donut-legend");
    
    donutContainer.innerHTML = "";
    legendContainer.innerHTML = "";

    const currency = this.activeGroup.currency;

    if (totalSpend === 0) {
      donutContainer.innerHTML = `<span style="font-size:0.75rem; color:var(--text-muted);">No spending data</span>`;
      
      const barsContainer = document.getElementById("chart-bars-container");
      const barsLabels = document.getElementById("chart-bars-labels");
      barsContainer.innerHTML = `<span style="font-size:0.75rem; color:var(--text-muted); align-self:center;">No spending data</span>`;
      barsLabels.innerHTML = "";
      return;
    }

    const categoryMeta = {
      meals: { label: "Meals", icon: "🍔", color: "#f59e0b" },
      transport: { label: "Transport", icon: "🚗", color: "#3b82f6" },
      lodging: { label: "Lodging", icon: "🏨", color: "#8b5cf6" },
      groceries: { label: "Groceries", icon: "🛒", color: "#10b981" },
      entertainment: { label: "Entertainment", icon: "🍿", color: "#ec4899" },
      utilities: { label: "Utilities", icon: "⚡", color: "#06b6d4" },
      other: { label: "Other", icon: "📦", color: "#64748b" }
    };

    let svgHtml = `<svg width="140" height="140" viewBox="0 0 100 100" style="transform: rotate(-90deg);">`;
    svgHtml += `<circle cx="50" cy="50" r="40" fill="transparent" stroke="rgba(255,255,255,0.05)" stroke-width="8"/>`;

    let accumulatedPercent = 0;
    Object.entries(categoriesSum).forEach(([cat, amount]) => {
      const pct = (amount / totalSpend) * 100;
      const meta = categoryMeta[cat] || { label: cat, icon: "📦", color: "#64748b" };
      
      const c = 251.32;
      const strokeDashArray = `${(pct * c / 100).toFixed(2)} ${c.toFixed(2)}`;
      const strokeDashOffset = `-${(accumulatedPercent * c / 100).toFixed(2)}`;
      
      svgHtml += `<circle cx="50" cy="50" r="40" fill="transparent" stroke="${meta.color}" stroke-width="8" stroke-dasharray="${strokeDashArray}" stroke-dashoffset="${strokeDashOffset}" style="transition: stroke-dasharray 0.5s ease;"/>`;
      accumulatedPercent += pct;

      const leg = document.createElement("div");
      leg.style = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.15rem;";
      leg.innerHTML = `
        <div style="display:flex; align-items:center; gap:0.25rem;">
          <span style="color:${meta.color}; font-size:0.6rem; vertical-align:middle; line-height:1;">●</span>
          <span>${meta.icon} ${meta.label}</span>
        </div>
        <span style="font-weight:600; color:var(--text-primary);">${currency}${amount.toFixed(2)} (${pct.toFixed(0)}%)</span>
      `;
      legendContainer.appendChild(leg);
    });

    svgHtml += `</svg>`;
    
    const totalOverlay = document.createElement("div");
    totalOverlay.style = "position: absolute; display: flex; flex-direction: column; align-items: center; pointer-events: none; text-align: center;";
    totalOverlay.innerHTML = `
      <span style="font-size:0.65rem; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing:0.02em;">Total</span>
      <span style="font-size:0.85rem; font-weight:700; color:var(--text-primary);">${currency}${totalSpend.toFixed(0)}</span>
    `;
    
    donutContainer.innerHTML = svgHtml;
    donutContainer.appendChild(totalOverlay);

    const barsContainer = document.getElementById("chart-bars-container");
    const barsLabels = document.getElementById("chart-bars-labels");
    
    barsContainer.innerHTML = "";
    barsLabels.innerHTML = "";

    const maxPaid = Math.max(...Object.values(memberPaidSum), 0);

    Object.entries(memberPaidSum).forEach(([member, paid]) => {
      const pct = maxPaid > 0 ? (paid / maxPaid) * 100 : 0;
      
      const col = document.createElement("div");
      col.style = "display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; width: 24px; position: relative;";
      
      const bar = document.createElement("div");
      bar.style = `height: ${pct.toFixed(0)}%; width: 14px; background: var(--primary-color); border-radius: 4px; transition: height 0.5s ease; cursor: pointer;`;
      bar.title = `${member} paid ${currency}${paid.toFixed(2)}`;
      
      col.appendChild(bar);
      barsContainer.appendChild(col);

      const label = document.createElement("div");
      label.style = "width: 24px; text-align: center; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;";
      label.textContent = member.substring(0, 3);
      label.title = member;
      barsLabels.appendChild(label);
    });
  }

  async restoreLastDeletedItem() {
    if (!this.activeGroup || !this.lastDeletedItem) return;
    
    const { type, data } = this.lastDeletedItem;
    if (type === "expense") {
      this.activeGroup.expenses.push(data);
      if (data.hasReceipt && this.lastDeletedItem.receiptData) {
        await this.saveReceiptImage(data.id, this.lastDeletedItem.receiptData);
        this.activeGroup.receiptList = this.activeGroup.receiptList || [];
        this.activeGroup.receiptList.push({ expenseId: data.id, timestamp: Date.now() });
      }
      this.logActivity(`restored expense "${data.description}"`, false);
      await this.triggerStateSave();
      this.showToast(`Restored expense "${data.description}"`, "success");
    } else if (type === "settlement") {
      this.activeGroup.settlements.push(data);
      this.logActivity(`restored settlement: paid ${data.recipient} ${this.activeGroup.currency}${parseFloat(data.amount).toFixed(2)}`, false);
      await this.triggerStateSave();
      this.showToast(`Restored settlement`, "success");
    }
    
    this.lastDeletedItem = null;
  }

  checkIosInstallPrompt() {
    // Detect if device is iOS (iPhone/iPad/iPod)
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    
    // Detect if page is running in standalone mode (i.e. already installed)
    const isStandalone = window.navigator.standalone === true || 
      window.matchMedia('(display-mode: standalone)').matches;

    // Check if user dismissed prompt previously
    const isDismissed = localStorage.getItem("ios_pwa_prompt_dismissed") === "true";

    if (isIos && !isStandalone && !isDismissed) {
      const promptEl = document.getElementById("ios-install-prompt");
      if (promptEl) {
        promptEl.style.display = "flex";
        
        const closeBtn = document.getElementById("btn-close-ios-prompt");
        if (closeBtn) {
          closeBtn.addEventListener("click", () => {
            promptEl.style.display = "none";
            localStorage.setItem("ios_pwa_prompt_dismissed", "true");
          });
        }
      }
    }
  }

  async addNote(text) {
    if (!this.activeGroup || !text) return;
    this.activeGroup.notes = this.activeGroup.notes || [];
    
    if (this.activeGroup.notes.length >= 30) {
      this.activeGroup.notes.shift();
    }
    
    const noteObj = {
      id: "note_" + Math.random().toString(36).substring(2, 11),
      author: this.currentUser || "System",
      text: text.trim(),
      timestamp: Date.now()
    };
    
    this.activeGroup.notes.push(noteObj);
    this.logActivity(`pinned a note: "${text.substring(0, 30)}..."`, false);
    await this.triggerStateSave();
    this.showToast("Note pinned to board!", "success");
    this.renderNotesWall();
  }

  async deleteNote(noteId) {
    if (!this.activeGroup) return;
    this.activeGroup.notes = this.activeGroup.notes || [];
    const note = this.activeGroup.notes.find(n => n.id === noteId);
    this.activeGroup.notes = this.activeGroup.notes.filter(n => n.id !== noteId);
    this.logActivity(`removed note: "${note ? note.text.substring(0, 30) : noteId}..."`, false);
    await this.triggerStateSave();
    this.showToast("Note deleted from board.", "success");
    this.renderNotesWall();
  }

  renderNotesWall() {
    const container = document.getElementById("notes-list");
    if (!container) return;
    container.innerHTML = "";
    
    const notes = this.activeGroup.notes || [];
    if (notes.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 2rem 1rem; color: var(--text-muted);">
          <span style="font-size: 2rem;">📌</span>
          <p>No notes pinned yet on this board. Type below to pin one!</p>
        </div>
      `;
      return;
    }
    
    const sorted = [...notes].sort((a, b) => b.timestamp - a.timestamp);
    
    sorted.forEach(note => {
      const card = document.createElement("div");
      card.className = "glass-panel animate-fade-in";
      card.style = "padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; border-color: rgba(99, 102, 241, 0.15); position: relative; border-radius: var(--radius-md); box-sizing: border-box;";
      
      const date = new Date(note.timestamp);
      const timeStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      
      card.innerHTML = `
        <button type="button" class="btn-delete-note" style="position: absolute; top: 0.5rem; right: 0.5rem; background: none; border: none; font-size: 1.1rem; cursor: pointer; color: var(--text-muted); padding: 0.2rem; line-height: 1;">&times;</button>
        <div style="font-size: 0.9rem; color: var(--text-primary); line-height: 1.4; word-break: break-word;">${note.text}</div>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.7rem; color: var(--text-muted); margin-top: auto; border-top: 1px solid var(--surface-border); padding-top: 0.5rem;">
          <span style="font-weight: 700; color: var(--primary-color);">${note.author}</span>
          <span>${timeStr}</span>
        </div>
      `;
      
      card.querySelector(".btn-delete-note").addEventListener("click", () => {
        if (confirm("Delete this pinned note?")) {
          this.deleteNote(note.id);
        }
      });
      
      container.appendChild(card);
    });
  }

  async performGeminiScan(file) {
    const cloudKey = this.activeGroup ? this.activeGroup.geminiApiKey : "";
    const key = cloudKey || localStorage.getItem("gemini_api_key");
    if (!key) {
      this.showToast("Please save your Gemini API Key in Settings first!", "error");
      document.getElementById("api-key-dialog").showModal();
      return;
    }

    const scannerOverlay = document.getElementById("scanner-overlay");
    const scannerStatus = document.getElementById("scanner-status");
    
    scannerOverlay.style.display = "flex";
    scannerStatus.textContent = "AI Scanning Receipt...";

    try {
      const getBase64 = (f) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(f);
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = error => reject(error);
      });

      const base64Data = await getBase64(file);
      
      this.attachedReceiptBase64 = `data:${file.type};base64,${base64Data}`;
      const indicator = document.getElementById("expense-receipt-indicator");
      if (indicator) {
        indicator.textContent = "📎 Image Attached";
        indicator.style.color = "var(--success-color)";
        indicator.style.display = "inline-block";
      }
      
      scannerStatus.textContent = "Analyzing with Gemini AI...";

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: file.type,
                    data: base64Data
                  }
                },
                {
                  text: "Analyze this receipt. Return ONLY a valid JSON object matching this schema: { \"description\": \"Short descriptor string e.g. Starbucks Coffee\", \"amount\": number e.g. 24.50, \"category\": \"meals\"|\"transport\"|\"lodging\"|\"groceries\"|\"entertainment\"|\"utilities\"|\"other\", \"date\": \"YYYY-MM-DD\" }. Do not wrap in markdown or backticks."
                }
              ]
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      const data = await response.json();
      let resultText = data.candidates[0].content.parts[0].text.trim();
      
      if (resultText.startsWith("```")) {
        resultText = resultText.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
      }

      const result = JSON.parse(resultText);

      if (result.description) document.getElementById("expense-desc").value = result.description;
      if (result.amount) document.getElementById("expense-amount").value = parseFloat(result.amount).toFixed(2);
      if (result.date) document.getElementById("expense-date").value = result.date;
      
      if (result.category) {
        const radio = document.querySelector(`input[name="expense-category"][value="${result.category}"]`);
        if (radio) radio.checked = true;
      }

      document.getElementById("expense-desc").dispatchEvent(new Event("input"));
      
      this.showToast(`OCR Scan complete: Extracted "${result.description}" for ${this.activeGroup.currency}${result.amount}!`, "success");

    } catch (err) {
      console.error(err);
      this.showToast("Gemini scan failed: " + err.message, "error");
    } finally {
      scannerOverlay.style.display = "none";
      document.getElementById("scan-receipt-file-input").value = "";
    }
  }

  generateDuitNowEMVCo(type, id, name, amount, currency) {
    const f = (tag, val) => tag + String(val.length).padStart(2, '0') + val;
    
    let typeVal = "01";
    if (type === "nric") typeVal = "02";
    if (type === "bank") typeVal = "05";
    
    let normalizedId = id;
    if (type === "phone") {
      if (normalizedId.startsWith("0")) {
        normalizedId = "6" + normalizedId;
      } else if (!normalizedId.startsWith("60") && !normalizedId.startsWith("+")) {
        normalizedId = "60" + normalizedId;
      }
      normalizedId = normalizedId.replace("+", "");
    }
    
    const merchantInfo = f("00", "MY.DUITNOW.P2P") + 
                         f("01", typeVal) + 
                         f("02", normalizedId);
                         
    let payload = f("00", "01") + 
                  f("01", amount ? "12" : "11") +
                  f("26", merchantInfo) + 
                  f("52", "0000") + 
                  f("53", currency === "SGD" ? "702" : "458") + 
                  (amount ? f("54", parseFloat(amount).toFixed(2)) : "") + 
                  f("58", "MY") + 
                  f("59", name.substring(0, 25)) + 
                  f("60", "Kuala Lumpur");
                  
    payload += "6304";
    let crc = 0xFFFF;
    for (let i = 0; i < payload.length; i++) {
      let x = ((crc >> 8) ^ payload.charCodeAt(i)) & 0xFF;
      x ^= x >> 4;
      crc = ((crc << 8) ^ (x << 12) ^ (x << 5) ^ (x << 0)) & 0xFFFF;
    }
    const crcString = crc.toString(16).toUpperCase().padStart(4, '0');
    return payload + crcString;
  }

  checkOnboarding() {
    if (!this.activeGroup) return;

    const savedName = localStorage.getItem("fairshare_my_name");
    const memberExists = savedName && this.activeGroup.members.includes(savedName);

    const dialog = document.getElementById("onboarding-dialog");
    if (!memberExists && dialog && !dialog.open) {
      this.openOnboardingDialog();
    }
  }

  openOnboardingDialog() {
    const dialog = document.getElementById("onboarding-dialog");
    if (!dialog) return;

    dialog.addEventListener("cancel", (e) => e.preventDefault());
    
    const select = document.getElementById("onboarding-select-member");
    select.innerHTML = '<option value="">-- Select Member Name --</option>';
    
    this.activeGroup.members.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      select.appendChild(opt);
    });

    document.getElementById("onboarding-input-name").value = "";
    dialog.showModal();
  }

  compressImage(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const MAX_WIDTH = 1024;
          const MAX_HEIGHT = 1024;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob((blob) => {
            const compressedFile = new File([blob], file.name, {
              type: "image/jpeg",
              lastModified: Date.now()
            });
            resolve(compressedFile);
          }, "image/jpeg", 0.7);
        };
      };
    });
  }
}

// Instantiate the application on page load
window.addEventListener("DOMContentLoaded", () => {
  window.app = new SataSplitApp();
});
