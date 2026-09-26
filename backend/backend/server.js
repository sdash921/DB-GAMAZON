require("dotenv").config();

const express = require("express");
const cors = require("cors");
const pool = require("./db");
const authRoutes = require("./routes/auth");
const authenticateToken = require("./middleware/auth");

const requireRole = require("./middleware/role");

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
    res.json({
        message: "GAmazon API is running"
    });
});

app.get("/api/test-db", async (req, res) => {
    try {
        const result = await pool.query("SELECT NOW()");

        res.json({
            message: "Database connected!",
            time: result.rows[0].now
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Database connection failed"
        });
    }
});

app.get("/api/customers", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM customers ORDER BY customer_id"
        );

        res.json(result.rows);
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Failed to get customers"
        });
    }
});

app.get("/api/profile", authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT user_id, customer_id, email, role, created_at
             FROM users
             WHERE user_id = $1`,
            [req.user.user_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        res.json({
            user: result.rows[0]
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Failed to get profile"
        });
    }
});

app.get(
    "/api/admin",
    authenticateToken,
    requireRole("Admin"),
    (req, res) => {
        res.json({
            message: "Welcome to Admin area",
            user: req.user
        });
    }
);

app.get(
    "/api/manager",
    authenticateToken,
    requireRole("Manager", "Admin"),
    (req, res) => {
        res.json({
            message: "Welcome to Manager area",
            user: req.user
        });
    }
);

app.get(
    "/api/customer",
    authenticateToken,
    requireRole("Customer", "Admin"),
    (req, res) => {
        res.json({
            message: "Welcome to Customer area",
            user: req.user
        });
    }
);

const PORT = 3000;

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});