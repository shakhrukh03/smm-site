/* ==========================================================
   1. ДАННЫЕ УСЛУГ И СОСТОЯНИЕ
   ========================================================== */
const servicesData = {
  followers: [
    { id: 1, name: "Подписчики — Стандарт 🇰🇿", isHit: true, quality: "★★★★★", speed: "До 24 часов", price: 1490 },
    { id: 2, name: "Подписчики — Премиум 🇰🇿", isHit: false, quality: "★★★★★", speed: "До 12 часов", price: 2290 },
    { id: 3, name: "Подписчики — VIP 🇰🇿", isHit: false, quality: "★★★★★", speed: "До 6 часов", price: 3490 },
    { id: 4, name: "Подписчики — Микс 🌍", isHit: false, quality: "★★★☆☆", speed: "До 24 часов", price: 890 }
  ],
  likes: [
    { id: 5, name: "Лайки — Стандарт", isHit: true, quality: "★★★★★", speed: "До 1 часа", price: 690 },
    { id: 6, name: "Лайки — Премиум", isHit: false, quality: "★★★★★", speed: "До 30 минут", price: 990 }
  ],
  views: [
    { id: 7, name: "Просмотры — Быстрые", isHit: true, quality: "★★★★★", speed: "До 20 минут", price: 390 }
  ]
};

let currentCategory = "followers";
let selectedService = servicesData.followers[0];
let quantity = 1000;

const formatMoney = (amount) => new Intl.NumberFormat("ru-RU").format(amount) + " ₸";

/* ==========================================================
   2. API-ВЗАИМОДЕЙСТВИЕ С СЕРВЕРОМ
   ========================================================== */
async function apiRequest(url, method = 'GET', body = null) {
  const token = localStorage.getItem('nak_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const config = { method, headers };
    if (body) config.body = JSON.stringify(body);

    const res = await fetch(url, config);
    return await res.json();
  } catch (err) {
    console.error('Ошибка сети:', err);
    return { error: 'Ошибка соединения с сервером' };
  }
}

/* ==========================================================
   3. УПРАВЛЕНИЕ МОДАЛЬНЫМИ ОКНАМИ И ВКЛАДКАМИ
   ========================================================== */
function openModal(formType = 'login') {
  const modal = document.getElementById('modalBackdrop');
  if (modal) {
    modal.style.display = 'flex';
    showForm(formType);
  }
}

function closeModal() {
  const modal = document.getElementById('modalBackdrop');
  if (modal) modal.style.display = 'none';
}

function showForm(formType) {
  const loginForm = document.getElementById('loginForm');
  const regForm = document.getElementById('registerForm');
  if (formType === 'login') {
    if (loginForm) loginForm.hidden = false;
    if (regForm) regForm.hidden = true;
  } else {
    if (loginForm) loginForm.hidden = true;
    if (regForm) regForm.hidden = false;
  }
}

function showDashboard() {
  document.getElementById('services').style.display = 'none';
  document.getElementById('how').style.display = 'none';
  const dash = document.getElementById('dashboard');
  if (dash) dash.style.display = 'block';
  updateAuth();
}

function hideDashboard() {
  document.getElementById('services').style.display = 'block';
  document.getElementById('how').style.display = 'block';
  const dash = document.getElementById('dashboard');
  if (dash) dash.style.display = 'none';
}

function openTab(tabName) {
  document.getElementById('tab-orders').hidden = tabName !== 'orders';
  document.getElementById('tab-deposit').hidden = tabName !== 'deposit';
}

/* ==========================================================
   4. АВТОРИЗАЦИЯ И ПРОФИЛЬ
   ========================================================== */
async function login() {
  const username = document.getElementById("loginUser").value.trim();
  const password = document.getElementById("loginPass").value;

  if (!username || !password) return showToast("Заполните все поля!");

  const data = await apiRequest('/api/auth/login', 'POST', { username, password });

  if (data.success) {
    localStorage.setItem('nak_token', data.token);
    closeModal();
    showToast("Вы успешно вошли!");
    updateAuth();
  } else {
    showToast(data.error || "Ошибка входа");
  }
}

async function register() {
  const username = document.getElementById("regUser").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPass").value;

  if (!username || !email || !password) return showToast("Заполните все поля!");

  const data = await apiRequest('/api/auth/register', 'POST', { username, email, password });

  if (data.success) {
    localStorage.setItem('nak_token', data.token);
    closeModal();
    showToast("Аккаунт создан!");
    updateAuth();
  } else {
    showToast(data.error || "Ошибка регистрации");
  }
}

function logout() {
  localStorage.removeItem('nak_token');
  location.reload();
}

// Пополнение баланса через Kaspi (Заявка в Telegram)
async function submitTopup() {
  const token = localStorage.getItem('nak_token');
  if (!token) {
    showToast('Сначала войдите в аккаунт!');
    openModal('login');
    return;
  }

  const amountInput = document.getElementById('topup-amount');
  const amount = amountInput ? amountInput.value : null;

  if (!amount || amount <= 0) {
    showToast('Укажите корректную сумму');
    return;
  }

  const data = await apiRequest('/api/topup/create', 'POST', { amount });

  if (data.success) {
    showToast('Заявка отправлена! Ожидайте подтверждения.');
    if (amountInput) amountInput.value = '';
  } else {
    showToast(data.error || 'Ошибка при отправке заявки.');
  }
}

async function updateAuth() {
  const token = localStorage.getItem('nak_token');
  const area = document.getElementById("authArea");
  if (!area) return;

  if (!token) {
    area.innerHTML = `
      <button class="btn-login" onclick="openModal('login')">Войти</button>
      <button class="btn-register" onclick="openModal('register')">Регистрация</button>
    `;
    return;
  }

  const data = await apiRequest('/api/user/me');

  if (data.user) {
    area.innerHTML = `
      <button class="btn-login" onclick="showDashboard()">
        Баланс: ${formatMoney(data.user.balance)}
      </button>
      <button class="btn-register" onclick="logout()">Выйти</button>
    `;

    if (document.getElementById("dashBalance")) {
      document.getElementById("dashBalance").textContent = formatMoney(data.user.balance);
      document.getElementById("dashOrdersCount").textContent = data.orders ? data.orders.length : 0;
    }

    const ordersArea = document.getElementById("ordersTableArea");
    if (ordersArea && data.orders) {
      if (data.orders.length === 0) {
        ordersArea.innerHTML = "<p style='padding:15px; color:#666;'>У вас пока нет заказов.</p>";
      } else {
        ordersArea.innerHTML = `
          <table style="width:100%; border-collapse:collapse; margin-top:15px;">
            <thead>
              <tr style="text-align:left; border-bottom:1px solid #ccc;">
                <th style="padding:8px;">ID</th>
                <th style="padding:8px;">Услуга</th>
                <th style="padding:8px;">Кол-во</th>
                <th style="padding:8px;">Сумма</th>
                <th style="padding:8px;">Cтатус</th>
              </tr>
            </thead>
            <tbody>
              ${data.orders.map(o => `
                <tr style="border-bottom:1px solid #eee;">
                  <td style="padding:8px;">#${o.id}</td>
                  <td style="padding:8px;">${o.service_name}</td>
                  <td style="padding:8px;">${o.quantity}</td>
                  <td style="padding:8px;">${formatMoney(o.cost)}</td>
                  <td style="padding:8px;">${o.status}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }
    }
  } else {
    logout();
  }
}

/* ==========================================================
   5. ИНТЕРФЕЙС И КАЛЬКУЛЯТОР УСЛУГ
   ========================================================== */
function renderServices(category) {
  const container = document.getElementById("serviceRows");
  if (!container) return;
  const list = servicesData[category] || [];

  container.innerHTML = list.map(item => `
    <div class="service-row-item">
      ${item.isHit ? '<span class="hit-tag">Хит</span>' : ''}
      <div>
        <strong>${item.name}</strong>
        <br><small style="color:#888;">Реальные пользователи</small>
      </div>
      <span class="stars">${item.quality}</span>
      <span style="color:#777; font-size:12px;">${item.speed}</span>
      <span class="price-tag">${formatMoney(item.price)}</span>
      <button class="btn-buy-icon" onclick="selectService(${item.id})">🛒</button>
    </div>
  `).join('');
}

function selectService(id) {
  const found = servicesData[currentCategory].find(s => s.id === id);
  if (found) {
    selectedService = found;
    updateSummary();
  }
}

function updateSummary() {
  if (!document.getElementById("selectedServiceName")) return;

  document.getElementById("selectedServiceName").textContent = selectedService.name;
  document.getElementById("selectedQty").textContent = quantity;
  document.getElementById("selectedUnitPrice").textContent = formatMoney(selectedService.price);
  
  const total = Math.round((selectedService.price * quantity) / 1000);
  document.getElementById("totalPrice").textContent = formatMoney(total);
}

async function placeOrder() {
  const linkInput = document.getElementById("linkInput");
  const link = linkInput ? linkInput.value.trim() : "";

  if (!link) {
    showToast("Введите ссылку на аккаунт или пост!");
    return;
  }

  const token = localStorage.getItem('nak_token');
  if (!token) {
    showToast("Пожалуйста, войдите в аккаунт!");
    openModal('login');
    return;
  }

  const totalCost = Math.round((selectedService.price * quantity) / 1000);

  const data = await apiRequest('/api/orders/create', 'POST', {
    serviceName: selectedService.name,
    quantity: quantity,
    cost: totalCost,
    link: link
  });

  if (data.success) {
    showToast("Заказ успешно оформлен!");
    linkInput.value = "";
    updateAuth();
  } else {
    showToast(data.error || "Не удалось создать заказ");
  }
}

function scrollToServices() {
  const el = document.getElementById("services");
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = "block";
  setTimeout(() => toast.style.display = "none", 2500);
}

/* ==========================================================
   6. ЯВНАЯ ПРИВЯЗКА К ГЛОБАЛЬНОМУ ОКНУ (ДЛЯ HTML ONCLICK)
   ========================================================== */
window.openModal = openModal;
window.closeModal = closeModal;
window.showForm = showForm;
window.showDashboard = showDashboard;
window.hideDashboard = hideDashboard;
window.openTab = openTab;
window.login = login;
window.register = register;
window.logout = logout;
window.submitTopup = submitTopup;
window.selectService = selectService;
window.placeOrder = placeOrder;

/* ==========================================================
   7. СОБЫТИЯ И ИНИЦИАЛИЗАЦИЯ
   ========================================================== */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".cat-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".cat-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentCategory = btn.dataset.cat;
      renderServices(currentCategory);
      if (servicesData[currentCategory]?.[0]) {
        selectedService = servicesData[currentCategory][0];
        updateSummary();
      }
    });
  });

  const btnMinus = document.getElementById("qtyMinus");
  const btnPlus = document.getElementById("qtyPlus");
  const inputQty = document.getElementById("qtyInput");

  if (btnMinus) {
    btnMinus.onclick = () => {
      quantity = Math.max(100, quantity - 100);
      if (inputQty) inputQty.value = quantity;
      updateSummary();
    };
  }

  if (btnPlus) {
    btnPlus.onclick = () => {
      quantity += 100;
      if (inputQty) inputQty.value = quantity;
      updateSummary();
    };
  }

  if (inputQty) {
    inputQty.oninput = (e) => {
      quantity = Math.max(100, parseInt(e.target.value) || 100);
      updateSummary();
    };
  }

  renderServices("followers");
  updateSummary();
  updateAuth();
});