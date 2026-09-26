const { Pool } = require("pg");

const pool = new Pool({
    host: "localhost",
    port: 5432,
    database: "logistics",
    user: "postgres",
    password: "2850"
});

module.exports = pool;