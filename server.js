const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'your-secret-key-change-it-in-production';

// Настройки Telegram (ВАШИ ДАННЫЕ)
const TELEGRAM_TOKEN = '8925332625:AAEpgBseHvnBTcB486_D7N8t0uEkBswiAVE';
const ADMIN_CHAT_ID = '7825357527';

// Мидлвары
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Подключение к БД
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('Ошибка БД:', err.message);
    else console.log('База данных SQLite успешно подключена.');
});

// Создание таблиц
db.serialize(() => {
    // Пользователи
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            email TEXT UNIQUE,
            password TEXT,
            balance REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Заказы
    db.run(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            service_name TEXT,
            quantity INTEGER,
            cost REAL,
            link TEXT,
            status TEXT DEFAULT 'В обработке',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // Заявки на пополнение Kaspi
    db.run(`
        CREATE TABLE IF NOT EXISTS topups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            amount REAL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

// Прослойка проверки токена
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Недействительный токен' });
        req.user = user;
        next();
    });
}

/* ==========================================================
   МАРШРУТЫ АВТОРИЗАЦИИ И ПРОФИЛЯ
   ========================================================== */

app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(
            `INSERT INTO users (username, email, password) VALUES (?, ?, ?)`,
            [username, email, hashedPassword],
            function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Логин или Email уже существует' });
                    }
                    return res.status(500).json({ error: 'Ошибка сервера' });
                }
                const token = jwt.sign({ id: this.lastID, username }, JWT_SECRET, { expiresIn: '7d' });
                res.json({ success: true, token, user: { username, balance: 0 } });
            }
        );
    } catch (e) {
        res.status(500).json({ error: 'Ошибка хеширования пароля' });
    }
});

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? OR email = ?`, [username, username], async (err, user) => {
        if (err) return res.status(500).json({ error: 'Ошибка сервера' });
        if (!user) return res.status(400).json({ error: 'Неверный логин или пароль' });

        const validPass = await bcrypt.compare(password, user.password);
        if (!validPass) return res.status(400).json({ error: 'Неверный логин или пароль' });

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, user: { username: user.username, balance: user.balance } });
    });
});

app.get('/api/user/me', authenticateToken, (req, res) => {
    db.get(`SELECT username, email, balance FROM users WHERE id = ?`, [req.user.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Пользователь не найден' });

        db.all(`SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC`, [req.user.id], (err, orders) => {
            res.json({ user, orders: orders || [] });
        });
    });
});

/* ==========================================================
   ПОПОЛНЕНИЕ БАЛАНСА KASPI И TELEGRAM WEBHOOK
   ========================================================== */

app.post('/api/topup/create', authenticateToken, (req, res) => {
    const { amount } = req.body;
    const username = req.user.username;

    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Неверная сумма' });
    }

    db.run(
        `INSERT INTO topups (username, amount) VALUES (?, ?)`,
        [username, amount],
        function (err) {
            if (err) return res.status(500).json({ error: 'Ошибка БД' });

            const topupId = this.lastID;

            const message = `💰 *Новая заявка на пополнение Kaspi!*\n\n` +
                `👤 *Пользователь:* ${username}\n` +
                `💵 *Сумма:* ${amount} ₸\n` +
                `🆔 *Заявка #:* ${topupId}\n\n` +
                `Проверьте Kaspi и подтвердите перевод:`;

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
            }).catch(e => console.error('Ошибка отправки в Telegram:', e.message));

            res.json({ success: true, topupId });
        }
    );
});

app.post('/api/telegram-webhook', (req, res) => {
    const update = req.body;

    if (update && update.callback_query) {
        const query = update.callback_query;
        const data = query.data;
        const [action, topupId] = data.split('_');

        db.get(`SELECT * FROM topups WHERE id = ?`, [topupId], (err, topup) => {
            if (!topup || topup.status !== 'pending') {
                return res.json({ status: 'ok' });
            }

            if (action === 'approve') {
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
const nodemailer = require('nodemailer');

// Настройка транспорта для отправки писем
const transporter = nodemailer.createTransport({
  service: 'gmail', // или 'yandex', 'mail.ru'
  auth: {
    user: 'your_email@gmail.com',     // Ваша почта
    pass: 'your_app_password'         // Пароль приложения (генерируется в настройках аккаунта)
  }
});
db.run(`
  CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password TEXT,
      balance REAL DEFAULT 0,
      is_verified INTEGER DEFAULT 0,    -- 0 = не подтверждён, 1 = подтверждён
      verification_code TEXT,           -- Код подтверждения (например, 6 цифр)
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
/* ==========================================================
   ОФОРМЛЕНИЕ ЗАКАЗА
   ========================================================== */

app.post('/api/orders/create', authenticateToken, (req, res) => {
    const { serviceName, quantity, cost, link } = req.body;

    if (!serviceName || !quantity || !cost || !link) {
        return res.status(400).json({ error: 'Заполните все поля заказа' });
    }

    db.get(`SELECT balance FROM users WHERE id = ?`, [req.user.id], (err, user) => {
        if (err || !user) return res.status(500).json({ error: 'Ошибка поиска пользователя' });

        if (user.balance < cost) {
            return res.status(400).json({ error: `Недостаточно средств. Пополните баланс!` });
        }

        const newBalance = user.balance - cost;

        db.run(`UPDATE users SET balance = ? WHERE id = ?`, [newBalance, req.user.id], (err) => {
            if (err) return res.status(500).json({ error: 'Ошибка списания баланса' });

            db.run(
                `INSERT INTO orders (user_id, service_name, quantity, cost, link, status) VALUES (?, ?, ?, ?, ?, ?)`,
                [req.user.id, serviceName, quantity, cost, link, 'В обработке'],
                function (err) {
                    if (err) return res.status(500).json({ error: 'Ошибка сохранения заказа' });

                    res.json({
                        success: true,
                        orderId: this.lastID,
                        newBalance: newBalance
                    });
                }
            );
        });
    });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});