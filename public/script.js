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
// Настройки Telegram
const TELEGRAM_TOKEN = '8925332625:AAEpgBseHvnBTcB486_D7N8t0uEkBswiAVE';
const ADMIN_CHAT_ID = '7825357527'; // Ваш ID из @userinfobot
async function submitTopup() {
    const amount = document.getElementById('topup-amount').value;
    const username = localStorage.getItem('username'); // Или из вашей системы авторизации

    if (!amount || amount <= 0) {
        alert('Введите корректную сумму');
        return;
    }

    const res = await fetch('/api/topup/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, amount })
    });

    const data = await res.json();
    if (data.success) {
        alert('Заявка отправлена! Баланс пополнится автоматически после проверки платежа.');
    } else {
        alert('Ошибка при создании заявки.');
    }
}
// 1. Создаем таблицу для заявок на пополнение (если нет)
db.run(`CREATE TABLE IF NOT EXISTS topups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    amount REAL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// 2. Эндпоинт для создания заявки на пополнение
app.post('/api/topup/create', (req, res) => {
    const { username, amount } = req.body;

    if (!username || !amount || amount <= 0) {
        return res.status(400).json({ error: 'Неверные данные' });
    }

    db.run(
        `INSERT INTO topups (username, amount) VALUES (?, ?)`,
        [username, amount],
        function (err) {
            if (err) return res.status(500).json({ error: 'Ошибка БД' });

            const topupId = this.lastID;

            // Отправляем сообщение администратору в Telegram
            const message = `💰 *Новая заявка на пополнение!*\n\n` +
                `👤 *Пользователь:* ${username}\n` +
                `💵 *Сумма:* ${amount} ₸\n` +
                `🆔 *Заявка #:* ${topupId}\n\n` +
                `Проверьте Kaspi и нажмите кнопку ниже:`;

            const keyboard = {
                inline_keyboard: [[
                    { text: '✅ Подтвердить', callback_data: `approve_${topupId}` },
                    { text: '❌ Отклонить', callback_data: `reject_${topupId}` }
                ]]
            };

            axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                chat_id: ADMIN_CHAT_ID,
                text: message,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            }).catch(e => console.error('Ошибка Telegram:', e.message));

            res.json({ success: true, topupId });
        }
    );
});

// 3. Вебхук/Обработка нажатий кнопок в Telegram
app.post('/api/telegram-webhook', (req, res) => {
    const update = req.body;
    
    if (update.callback_query) {
        const query = update.callback_query;
        const data = query.data;
        const [action, topupId] = data.split('_');

        db.get(`SELECT * FROM topups WHERE id = ?`, [topupId], (err, topup) => {
            if (!topup || topup.status !== 'pending') {
                return res.json({ status: 'ok' });
            }

            if (action === 'approve') {
                // Пополняем баланс пользователю
                db.run(`UPDATE users SET balance = balance + ? WHERE username = ?`, [topup.amount, topup.username]);
                db.run(`UPDATE topups SET status = 'approved' WHERE id = ?`, [topupId]);

                axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: query.id,
                    text: `✅ Заявка #${topupId} на ${topup.amount}₸ одобрена!`
                });
            } else if (action === 'reject') {
                db.run(`UPDATE topups SET status = 'rejected' WHERE id = ?`, [topupId]);

                axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: query.id,
                    text: `❌ Заявка #${topupId} отклонена.`
                });
            }
        });
    }

    res.sendStatus(200);
});
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

// ФУНКЦИЯ ПОПОЛНЕНИЯ БАЛАНСА
async function addTestBalance(amount) {
  const data = await apiRequest('/api/user/add-balance', 'POST', { amount });
  if (data.success) {
    showToast(`Баланс пополнен на ${formatMoney(amount)}`);
    updateAuth();
  } else {
    showToast(data.error || "Ошибка пополнения");
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

    // Отрисовка таблицы заказов в ЛК
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

// Оформление заказа
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
window.addTestBalance = addTestBalance;
window.selectService = selectService;
window.placeOrder = placeOrder;

/* ==========================================================
   7. СОБЫТИЯ И ИНИЦИАЛИЗАЦИЯ
   ========================================================== */
document.addEventListener("DOMContentLoaded", () => {
  // Категории
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

  // Калькулятор
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

  // Запуск первичного отображения
  renderServices("followers");
  updateSummary();
  updateAuth();
});