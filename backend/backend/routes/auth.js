const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");


const router = express.Router();


router.post("/register", async (req, res) => {
    const { first_name, last_name, phone, email, password } = req.body;
    
    try {
        // 1. Проверяем, есть ли такой email
        const existingUser = await pool.query(
            "SELECT user_id FROM users WHERE email = $1",
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({
                message: "User with this email already exists"
            });
        }

        // 2. Хешируем пароль
        const passwordHash = await bcrypt.hash(password, 10);

        // 3. Создаём customer
        const customerResult = await pool.query(
            `INSERT INTO customers (first_name, last_name, phone, email)
             VALUES ($1, $2, $3, $4)
             RETURNING customer_id`,
            [first_name, last_name, phone, email]
        );

        const customerId = customerResult.rows[0].customer_id;

        // 4. Создаём пользователя
        const userResult = await pool.query(
            `INSERT INTO users (customer_id, email, password_hash, role)
             VALUES ($1, $2, $3, 'Customer')
             RETURNING user_id, customer_id, email, role, created_at`,
            [customerId, email, passwordHash]
        );

        res.status(201).json({
            message: "User registered successfully",
            user: userResult.rows[0]
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Registration failed"
        });
    }
});

router.post("/login", async (req, res) => {
    const { email, password } = req.body;

    try {
        // 1. Ищем пользователя
        const result = await pool.query(
            `SELECT user_id, customer_id, email, password_hash, role
             FROM users
             WHERE email = $1`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        const user = result.rows[0];

        // 2. Проверяем пароль
        const passwordMatch = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatch) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        // 3. Создаём JWT
        const token = jwt.sign(
            {
                user_id: user.user_id,
                customer_id: user.customer_id,
                role: user.role
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "1h"
            }
        );

        // 4. Отправляем token
        res.json({
            message: "Login successful",
            token: token,
            user: {
                user_id: user.user_id,
                customer_id: user.customer_id,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Login failed"
        });
    }
});

module.exports = router;
