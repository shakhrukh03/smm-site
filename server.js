const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'your-secret-key-change-it-in-production';

// Мидлвары
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Инициализация базы данных SQLite
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('Ошибка БД:', err.message);
    else console.log('База данных SQLite успешно подключена.');
});

// Создание таблиц
db.serialize(() => {
    // Таблица пользователей
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

    // Таблица заказов
    db.run(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            service_name TEXT,
            quantity INTEGER,
            cost REAL,
            target_link TEXT,
            status TEXT DEFAULT 'В обработке',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
});

// Прослойка проверки токена (Middleware)
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
   API МАРШРУТЫ (ROUTES)
   ========================================================== */

// 1. Регистрация
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
                        return res.status(400).json({ error: 'Пользователь с таким логином или Email уже существует' });
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

// 2. Вход (Логин)
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

// 3. Данные текущего профиля и заказов
app.get('/api/user/me', authenticateToken, (req, res) => {
    db.get(`SELECT username, email, balance FROM users WHERE id = ?`, [req.user.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'Пользователь не найден' });

        db.all(`SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC`, [req.user.id], (err, orders) => {
            res.json({ user, orders: orders || [] });
        });
    });
});

// 4. Оформление заказа
app.post('/api/orders/create', authenticateToken, (req, res) => {
    const { serviceName, quantity, cost, link } = req.body;

    if (!serviceName || !quantity || !cost || !link) {
        return res.status(400).json({ error: 'Некорректные данные заказа' });
    }

    db.get(`SELECT balance FROM users WHERE id = ?`, [req.user.id], (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'Пользователь не найден' });

        if (user.balance < cost) {
            return res.status(400).json({ error: `Недостаточно средств. Пополните баланс на ${cost - user.balance} ₸` });
        }

        // Начинаем транзакцию: списываем баланс и создаем заказ
        const newBalance = user.balance - cost;

        db.run(`UPDATE users SET balance = ? WHERE id = ?`, [newBalance, req.user.id], function (err) {
            if (err) return res.status(500).json({ error: 'Ошибка при списании баланса' });

            db.run(
                `INSERT INTO orders (user_id, service_name, quantity, cost, target_link) VALUES (?, ?, ?, ?, ?)`,
                [req.user.id, serviceName, quantity, cost, link],
                function (err) {
                    if (err) return res.status(500).json({ error: 'Ошибка сохранения заказа' });

                    res.json({
                        success: true,
                        message: 'Заказ успешно создан!',
                        newBalance,
                        orderId: this.lastID
                    });
                }
            );
        });
    });
});
// Тестовое пополнение баланса
const axios = require('axios'); // ⚠️ Обязательно добавьте эту строку в САМЫЙ ВЕРХ файла server.js!

// ==========================================
// НАСТРОЙКИ SMM-ПОСТАВЩИКА
// ==========================================
const PROVIDER_API_URL = 'https://provider-domain.com/api/v2'; // Ссылка на API вашего поставщика
const PROVIDER_API_KEY = 'YOUR_API_KEY_HERE';                 // Ваш API ключ из личного кабинета

// Таблица соответствия: "Название у нас" -> "ID услуги у поставщика"
const SERVICE_MAPPING = {
  "Подписчики — Стандарт 🇰🇿": 101, // Замените 101 на реальный ID услуги поставщика
  "Подписчики — Премиум 🇰🇿": 102,
  "Подписчики — VIP 🇰🇿": 103,
  "Подписчики — Микс 🌍": 104,
  "Лайки — Стандарт": 201,
  "Лайки — Премиум": 202,
  "Просмотры — Быстрые": 301
};

// ==========================================
// СОЗДАНИЕ И ОТПРАВКА ЗАКАЗА
// ==========================================
// НАСТРОЙКИ ПОСТАВЩИКА

app.post('/api/orders/create', authenticateToken, (req, res) => {
    const { serviceName, quantity, cost, link } = req.body;

    if (!serviceName || !quantity || !cost || !link) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    db.get(`SELECT balance FROM users WHERE id = ?`, [req.user.id], async (err, user) => {
        if (err || !user) return res.status(500).json({ error: 'Ошибка БД при поиске пользователя' });

        if (user.balance < cost) {
            return res.status(400).json({ error: 'Недостаточно средств на балансе' });
        }

        const providerServiceId = SERVICE_MAPPING[serviceName];
        if (!providerServiceId) {
            return res.status(400).json({ error: 'Выбранная услуга временно недоступна' });
        }

        let providerOrderId = null;

        try {
            /* 
            // ==========================================
            // ⚠️ БЛОК РЕАЛЬНОГО API (Раскомментировать при запуске)
            // ==========================================
            const params = new URLSearchParams();
            params.append('key', PROVIDER_API_KEY);
            params.append('action', 'add');
            params.append('service', providerServiceId);
            params.append('link', link);
            params.append('quantity', quantity);

            const providerRes = await axios.post(PROVIDER_API_URL, params);

            if (providerRes.data.error) {
                // Если поставщик отклонил заказ — деньги НЕ списываем!
                return res.status(400).json({ error: 'Ошибка поставщика: ' + providerRes.data.error });
            }

            providerOrderId = providerRes.data.order; 
            */

            // Тестовая заглушка (пока API ключ не введен)
            providerOrderId = "TEST_ORDER_" + Date.now();

            // Если заказ у поставщика успешно создался (или прошел тест) -> списываем баланс
            const newBalance = user.balance - cost;

            db.run(`UPDATE users SET balance = ? WHERE id = ?`, [newBalance, req.user.id], (err) => {
                if (err) return res.status(500).json({ error: 'Ошибка списания средств' });

                // Сохраняем заказ в локальную БД
                db.run(
                    `INSERT INTO orders (user_id, service_name, quantity, cost, link, status) VALUES (?, ?, ?, ?, ?, ?)`,
                    [req.user.id, serviceName, quantity, cost, link, 'В обработке'],
                    function(err) {
                        if (err) return res.status(500).json({ error: 'Ошибка сохранения заказа в БД' });

                        res.json({
                            success: true,
                            orderId: this.lastID,
                            providerOrderId: providerOrderId,
                            newBalance: newBalance
                        });
                    }
                );
            });

        } catch (apiError) {
            console.error('Ошибка соединения с API Поставщика:', apiError.message);
            return res.status(500).json({ error: 'Не удалось связаться с сервером поставщика' });
        }
    });
});
// Запуск сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});