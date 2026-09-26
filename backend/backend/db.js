const { Pool } = require("pg");

const pool = new Pool({
    host: "26.125.17.178", // IP твоего друга из Radmin VPN
    port: 5432,
    database: "logistics",
    user: "postgres",
    password: "2850"
});

module.exports = pool;