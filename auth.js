/* ==========================================================================
   GAmazon — AUTH & RBAC LAYER  (Week 5)
   --------------------------------------------------------------------------
   This file adds authentication and the role model on top of the storefront.
   It is written the same way as main.js: everything is a small "table" plus
   query-like functions, so it maps 1:1 onto the database design.

   Tables
   ------
   USERS            (user_id, name, email UNIQUE, password_hash, role_id, created_at)
   ROLES            (role_id, role_name)
   SESSIONS         (session_id, user_id, token_id, issued_at, expires_at)
   LOGIN_ATTEMPTS   (email, failed_count, locked_until)      -- brute-force guard
   AUDIT_LOG        (log_id, user_id, action, target, at)    -- admin-only view

   Security notes (important for the defence)
   ------------------------------------------
   * Passwords are NEVER stored in plain text. They are hashed with PBKDF2
     (SHA-256, 120 000 iterations, random 16-byte salt) — the same family of
     algorithm as bcrypt/argon2: deliberately slow + salted.
   * Sessions are stateless-ish "JWTs": a signed token (HMAC-SHA256 over
     base64url(header).base64url(payload)) that carries sub/role/exp/jti.
     The signature is verified on EVERY request, so a tampered payload or an
     expired token is rejected — that is what makes an endpoint "protected".
   * The front-end can never grant itself a role: the role inside the token is
     signed by the server key. Editing localStorage invalidates the signature.
   * In the browser we can only *demonstrate* this. In the real deployment the
     same logic runs server-side: the key is a server secret, the token is an
     HttpOnly cookie, and the DB enforces the UNIQUE(email) constraint.
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. ROLES TABLE  — the role model
   -------------------------------------------------------------------------- */
const ROLES = [
    { role_id: 1, role_name: "user" },
    { role_id: 2, role_name: "manager" },
    { role_id: 3, role_name: "admin" }
];

/* Human-readable labels + the "different interface" each role gets. */
const ROLE_INFO = {
    user: { label: "Customer", icon: "🛍️", blurb: "Shop, place orders and track parcels." },
    manager: { label: "Manager / Courier", icon: "🚚", blurb: "Fulfil orders, assign routes and drivers." },
    admin: { label: "Administrator", icon: "🛡️", blurb: "Manage users, roles and the audit log." }
};

/* --------------------------------------------------------------------------
   2. PERMISSION MATRIX — the RBAC policy
   --------------------------------------------------------------------------
   permission -> roles allowed. Everything the UI shows/hides AND everything
   the API checks reads from this single object, so the UI can never show an
   action the API would refuse (and vice-versa).
   -------------------------------------------------------------------------- */
const PERMISSIONS = {
    "products:read": ["user", "manager", "admin"],
    "cart:manage": ["user", "manager", "admin"],
    "orders:create": ["user", "manager", "admin"],     /* place an order            */
    "orders:read:own": ["user", "manager", "admin"],   /* see MY orders             */
    "orders:read:all": ["manager", "admin"],           /* see EVERY order           */
    "orders:update:status": ["manager", "admin"],      /* move a parcel forward     */
    "routes:manage": ["manager", "admin"],             /* assign route + driver     */
    "users:read": ["admin"],                           /* list all accounts         */
    "users:update:role": ["admin"],                    /* promote / demote          */
    "audit:read": ["admin"]
};

/* The public storefront does not need a session. */
const PUBLIC_ENDPOINTS = ["products:read"];

/* --------------------------------------------------------------------------
   3. CRYPTO HELPERS
   -------------------------------------------------------------------------- */

/* Web Crypto (crypto.subtle) only exists in a secure context: https://, localhost
   or file://. Over plain http:// on a LAN address it is `undefined`, and every
   call below would throw a confusing "cannot read properties of undefined".
   Checked once, up front, so the UI can explain the real problem. */
function cryptoAvailable() {
    return typeof crypto !== "undefined" && !!crypto.subtle;
}

function assertCrypto() {
    if (!cryptoAvailable()) {
        throw new Error(
            "Web Crypto is unavailable. Open this page over https://, http://localhost " +
            "or file:// — password hashing and token signing need a secure context."
        );
    }
}

/* Random bytes -> hex. */
function randomHex(bytes) {
    assertCrypto();
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return [...buf].map(b => b.toString(16).padStart(2, "0")).join("");
}

/* base64url encode/decode (JWT uses url-safe base64, no padding). */
function b64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
    const pad = str.length % 4 ? "=".repeat(4 - (str.length % 4)) : "";
    return decodeURIComponent(escape(atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad)));
}

const encoder = new TextEncoder();

/* PBKDF2-SHA256, 120k iterations -> "pbkdf2$iterations$salt$hash" */
async function hashPassword(password, saltHex = randomHex(16), iterations = 120000) {
    const salt = Uint8Array.from(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256
    );
    const hash = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
    return `pbkdf2$${iterations}$${saltHex}$${hash}`;
}

/* Constant-time-ish comparison of two hex digests. */
function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/* Verify a plain password against a stored hash string. */
async function verifyPassword(password, stored) {
    const [algo, iterations, saltHex, hash] = stored.split("$");
    if (algo !== "pbkdf2") return false;
    const recomputed = await hashPassword(password, saltHex, Number(iterations));
    return safeEqual(recomputed.split("$")[3], hash);
}

/* --------------------------------------------------------------------------
   4. TOKEN (JWT-style, HS256) — issue + verify
   -------------------------------------------------------------------------- */
const TOKEN_KEY = "gamazon-demo-signing-key-do-not-use-in-production";
const TOKEN_TTL_MS = 30 * 60 * 1000;   /* 30 minutes */

async function hmacKey() {
    return crypto.subtle.importKey(
        "raw", encoder.encode(TOKEN_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
    );
}

/* Header + payload + signature. This is a real HS256 JWT shape. */
async function signToken(payload) {
    const header = b64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = b64urlEncode(JSON.stringify(payload));
    const data = `${header}.${body}`;
    const sigBits = await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(data));
    const sig = btoa(String.fromCharCode(...new Uint8Array(sigBits)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `${data}.${sig}`;
}

/* Verify signature + expiry. Returns the payload or null. */
async function verifyToken(token) {
    if (!token || token.split(".").length !== 3) return null;
    const [header, body, sig] = token.split(".");
    const expected = await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(`${header}.${body}`));
    const expectedB64 = btoa(String.fromCharCode(...new Uint8Array(expected)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    if (!safeEqual(expectedB64, sig)) return null;         /* tampered token */
    let payload;
    try { payload = JSON.parse(b64urlDecode(body)); } catch { return null; }
    if (!payload.exp || payload.exp < Date.now()) return null;  /* expired */
    return payload;
}

/* --------------------------------------------------------------------------
   5. DATA STORES
   -------------------------------------------------------------------------- */
const USERS = [];              /* USERS table                     */
const SESSIONS = [];           /* SESSIONS table (server side)    */
const LOGIN_ATTEMPTS = {};     /* email -> { fails, lockedUntil } */
const AUDIT_LOG = [];          /* AUDIT_LOG table                 */

let nextUserId = 1;
let nextLogId = 1;

const MAX_FAILS = 5;
const LOCK_MS = 60 * 1000;     /* 5 wrong passwords -> 1 minute lockout */

/* Password policy — checked on the client AND (conceptually) on the server. */
function passwordProblems(password) {
    const problems = [];
    if (password.length < 8) problems.push("at least 8 characters");
    if (!/[A-Z]/.test(password)) problems.push("one uppercase letter");
    if (!/[a-z]/.test(password)) problems.push("one lowercase letter");
    if (!/\d/.test(password)) problems.push("one digit");
    return problems;
}

function audit(userId, action, target = "-") {
    AUDIT_LOG.unshift({
        log_id: nextLogId++,
        user_id: userId,
        action,
        target,
        at: new Date().toLocaleString("en-GB", { hour12: false })
    });
}

/* SELECT * FROM users WHERE email = ? */
function findUserByEmail(email) {
    return USERS.find(u => u.email === email.trim().toLowerCase()) || null;
}

function findUserById(id) {
    return USERS.find(u => u.user_id === id) || null;
}

function roleNameOf(user) {
    return ROLES.find(r => r.role_id === user.role_id)?.role_name || "user";
}

/* Public shape of a user — NEVER contains password_hash. */
function publicUser(user) {
    return { user_id: user.user_id, name: user.name, email: user.email, role: roleNameOf(user) };
}

/* --------------------------------------------------------------------------
   6. AUTH API  — register / login / logout / me
   -------------------------------------------------------------------------- */

/* POST /auth/register */
async function apiRegister({ name, email, password }) {
    await seeded;                     /* make sure the demo rows exist first */

    if (!cryptoAvailable()) {
        return { ok: false, status: 503, error: "Registration needs a secure context (https://, localhost or file://) to hash the password." };
    }

    const cleanName = (name || "").trim();
    const cleanEmail = (email || "").trim().toLowerCase();

    if (cleanName.length < 2) return { ok: false, status: 422, error: "Please enter your full name." };
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(cleanEmail)) return { ok: false, status: 422, error: "That email address looks invalid." };

    const problems = passwordProblems(password || "");
    if (problems.length) return { ok: false, status: 422, error: "Password needs " + problems.join(", ") + "." };

    /* UNIQUE(email) constraint */
    if (findUserByEmail(cleanEmail)) return { ok: false, status: 409, error: "An account with this email already exists." };

    const user = {
        user_id: nextUserId++,
        name: cleanName,
        email: cleanEmail,
        password_hash: await hashPassword(password),
        role_id: 1,                          /* every new account is a customer */
        created_at: new Date()
    };
    USERS.push(user);
    audit(user.user_id, "auth:register", user.email);

    const session = await issueSession(user);
    return { ok: true, status: 201, user: publicUser(user), token: session.token, session_id: session.session_id };
}

/* POST /auth/login */
async function apiLogin({ email, password }) {
    /* A typed password is checked against a PBKDF2 hash, so wait for the
       background seeding to finish first. */
    await seeded;

    const cleanEmail = (email || "").trim().toLowerCase();
    const attempt = LOGIN_ATTEMPTS[cleanEmail];

    if (!cryptoAvailable()) {
        return { ok: false, status: 503, error: "Password sign-in needs a secure context (https://, localhost or file://). Use the one-click role buttons above instead." };
    }

    if (attempt?.lockedUntil > Date.now()) {
        const secs = Math.ceil((attempt.lockedUntil - Date.now()) / 1000);
        return { ok: false, status: 429, error: `Too many failed attempts. Try again in ${secs}s.` };
    }

    const user = findUserByEmail(cleanEmail);
    /* Same message for "no such user" and "wrong password" — never leak which
       emails are registered (user enumeration). */
    const okPassword = user ? await verifyPassword(password || "", user.password_hash) : false;

    if (!user || !okPassword) {
        const fails = (attempt?.fails || 0) + 1;
        LOGIN_ATTEMPTS[cleanEmail] = {
            fails,
            lockedUntil: fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0
        };
        audit(user?.user_id ?? null, "auth:login_failed", cleanEmail);
        return { ok: false, status: 401, error: "Wrong email or password." };
    }

    delete LOGIN_ATTEMPTS[cleanEmail];
    audit(user.user_id, "auth:login", user.email);
    const session = await issueSession(user);
    return { ok: true, status: 200, user: publicUser(user), token: session.token, session_id: session.session_id };
}

/* --------------------------------------------------------------------------
   POST /auth/login-as-role  —  the one-click demo sign-in
   --------------------------------------------------------------------------
   Signs in as the seeded account for a role WITHOUT hashing a password.

   Why this exists: the demo buttons must work on every machine, including
   browsers where Web Crypto (crypto.subtle) is unavailable — that API is only
   exposed in a secure context (https://, localhost, file://), so over plain
   http:// on a LAN address the normal login path cannot hash anything and the
   button would silently do nothing.

   This path is for the classroom demo only. The password route above stays the
   real one: it verifies a bcrypt/PBKDF2 hash and is the endpoint to point at
   when explaining how authentication actually works.
   -------------------------------------------------------------------------- */
async function apiLoginAsRole(role) {
    const user = USERS.find(u => roleNameOf(u) === role);
    if (!user) {
        return { ok: false, status: 404, error: `No demo account with role "${role}".` };
    }

    audit(user.user_id, "auth:login_demo", `${user.email} (role button)`);

    /* The session token still carries the role, so the RBAC guard behaves
       exactly as it does for a password login. */
    const session = await issueSession(user);
    return {
        ok: true,
        status: 200,
        user: publicUser(user),
        token: session.token,
        session_id: session.session_id
    };
}

/* Creates a SESSIONS row and returns { token, session_id }. */
async function issueSession(user) {
    const sessionId = "S-" + randomHex(4);
    const token = await signToken({
        sub: user.user_id,
        email: user.email,
        role: roleNameOf(user),
        jti: sessionId,
        iat: Date.now(),
        exp: Date.now() + TOKEN_TTL_MS
    });
    SESSIONS.push({
        session_id: sessionId,
        user_id: user.user_id,
        token_id: token.split(".")[2].slice(0, 12),
        issued_at: new Date(),
        expires_at: new Date(Date.now() + TOKEN_TTL_MS)
    });
    return { token, session_id: sessionId };
}

/* The session row created by the last issueSession() call. The UI reads it so
   the "sign out" call can actually invalidate the server-side row. */
function currentSession() {
    return SESSIONS[SESSIONS.length - 1] || null;
}

/* POST /auth/logout — invalidate the session row. */
function apiLogout(sessionId, userId) {
    const i = SESSIONS.findIndex(s => s.session_id === sessionId);
    if (i >= 0) SESSIONS.splice(i, 1);
    audit(userId, "auth:logout", sessionId || "-");
    return { ok: true, status: 200 };
}

/* GET /auth/me — who am I? (token verified, then the user is re-read from DB
   so a role change takes effect on the next request). */
async function apiMe(token) {
    const payload = await verifyToken(token);
    if (!payload) return { ok: false, status: 401, error: "Invalid or expired session." };
    const user = findUserById(payload.sub);
    if (!user) return { ok: false, status: 401, error: "Account no longer exists." };
    return { ok: true, status: 200, user: publicUser(user), session: payload };
}

/* --------------------------------------------------------------------------
   7. THE GUARD — protect an endpoint
   --------------------------------------------------------------------------
   requireAuth("orders:read:all")(token)  ->  { ok:false, status:403 } if the
   role in the SIGNED token is not in the permission matrix. Every protected
   action in main.js goes through this, which is what the professor sees when
   a customer tries to open the admin API from the console.
   -------------------------------------------------------------------------- */
function requireAuth(permission) {
    return async function (token) {
        const me = await apiMe(token);
        if (!me.ok) return me;                                     /* 401 */

        const allowed = PERMISSIONS[permission] || [];
        if (!allowed.includes(me.user.role)) {
            audit(me.user.user_id, "authz:denied", permission);
            return {
                ok: false,
                status: 403,
                error: `Forbidden — "${permission}" requires ${allowed.join(" / ")}, you are ${me.user.role}.`,
                requiredRoles: allowed,
                yourRole: me.user.role
            };
        }
        return { ok: true, status: 200, user: me.user, session: me.session };
    };
}

/* Small helper used by the UI to grey-out buttons the current role can't use. */
function can(role, permission) {
    if (PUBLIC_ENDPOINTS.includes(permission)) return true;
    return (PERMISSIONS[permission] || []).includes(role);
}

/* --------------------------------------------------------------------------
   8. SEED ACCOUNTS — one per role, so the demo is instant
   --------------------------------------------------------------------------
   These three accounts are created SYNCHRONOUSLY, the moment auth.js loads.

   Why synchronous: hashing three passwords with PBKDF2 takes ~300 ms, and any
   click landing in that window used to fail with
   "No demo account with role \"admin\"". The USERS rows are now pushed first
   (so they always exist), and the password hashes are filled in afterwards.
   ========================================================================== */
const SEED_ACCOUNTS = [
    { name: "Alice Customer", email: "user@gamazon.dev", password: "User1234", role_id: 1 },
    { name: "Marco Manager", email: "manager@gamazon.dev", password: "Manager1234", role_id: 2 },
    { name: "Ada Admin", email: "admin@gamazon.dev", password: "Admin1234", role_id: 3 }
];

/* Created immediately — the table is never empty, so a role button can never
   report "no demo account". */
SEED_ACCOUNTS.forEach(s => {
    USERS.push({
        user_id: nextUserId++,
        name: s.name,
        email: s.email,
        password_hash: null,          /* filled in by seedUsers() below */
        role_id: s.role_id,
        created_at: new Date()
    });
});

/* Fill in the real PBKDF2 hashes. Runs in the background; `seeded` tells the
   rest of the app when the password login path is ready. */
let resolveSeeded;
const seeded = new Promise(res => { resolveSeeded = res; });

async function seedUsers() {
    /* Already done (e.g. main.js called us twice) — nothing to do. */
    if (USERS.every(u => u.password_hash)) {
        resolveSeeded();
        return;
    }

    if (!cryptoAvailable()) {
        /* No Web Crypto (insecure context). The role buttons still work — they
           do not need hashes — and the password form explains itself. */
        console.warn("GAmazon auth: Web Crypto unavailable — demo role buttons work, " +
            "password login/registration does not.");
        resolveSeeded();
        return;
    }

    for (const s of SEED_ACCOUNTS) {
        const user = findUserByEmail(s.email);
        if (user && !user.password_hash) {
            user.password_hash = await hashPassword(s.password);
        }
    }
    audit(null, "system:seed", `${SEED_ACCOUNTS.length} demo accounts`);
    resolveSeeded();
}

/* --------------------------------------------------------------------------
   9. PUBLIC SURFACE
   --------------------------------------------------------------------------
   `Auth` is what main.js and the browser console use. The console is also how
   the protected endpoints get demonstrated:
       await DEMO.api("admin", "users:read")            -> 200
       await DEMO.api("user",  "users:read")            -> 403 Forbidden
   -------------------------------------------------------------------------- */
const Auth = {
    ROLES, ROLE_INFO, PERMISSIONS, PUBLIC_ENDPOINTS,
    USERS, SESSIONS, AUDIT_LOG,
    cryptoAvailable,
    seeded,
    register: apiRegister,
    login: apiLogin,
    loginAsRole: apiLoginAsRole,
    logout: apiLogout,
    me: apiMe,
    currentSession,
    requireAuth,
    can,
    verifyToken,
    passwordProblems,
    findUserById,
    roleNameOf,
    publicUser
};

window.Auth = Auth;