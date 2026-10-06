This file used to fake authentication entirely in the browser (PBKDF2 hashing

a self-signed HMAC token + in-memory arrays). It now talks to the real
backend in backend/backend:

POST /api/auth/register   { first_name, last_name, phone, email, password }
POST /api/auth/login      { email, password }        -> { token, user }
GET  /api/profile         Authorization: Bearer <token>
GET  /api/customer        (role: Customer | Admin)
GET  /api/manager         (role: Manager  | Admin)
GET  /api/admin           (role: Admin)

The public surface (Auth.register, Auth.login, Auth.logout, Auth.me,
Auth.requireAuth, Auth.can, Auth.PERMISSIONS, ...) is kept identical so
main.js did not have to change its call sites. The difference is that every
call now performs a real HTTP request and the role is decided by the SERVER
from the signed JWT — the browser can no longer grant itself a role.

Security notes (important for the defence)

Passwords are NEVER stored in plain text. They are hashed with bcrypt
(10 salt rounds) in routes/auth.js, on the server.

The token is a real JWT signed with JWT_SECRET (HS256). It is verified by
middleware/auth.js on EVERY protected request, so a tampered or expired
token is rejected with 403 — that is what makes an endpoint "protected".

The front-end can never grant itself a role: the role lives inside the
signed token, and middleware/role.js compares it on the server.
========================================================================== */

The page is usually opened straight from disk (file://) while the API runs on
http://localhost:3000. Change API_BASE if your server uses another port/host.
-------------------------------------------------------------------------- */
const API_BASE = "http://localhost:3000";

/* --------------------------------------------------------------------------

ROLES TABLE  — the role model
-------------------------------------------------------------------------- */
const ROLES = [
{ role_id: 1, role_name: "user" },
{ role_id: 2, role_name: "manager" },
{ role_id: 3, role_name: "admin" }
];

/* The database stores Customer, Manager, Admin; the UI uses the lowercase
keys user, manager, admin. These two helpers translate between them so
the rest of the app (and the CSS) keeps working unchanged. */
function toUiRole(dbRole) {
const map = { customer: "user", manager: "manager", admin: "admin", user: "user" };
return map[String(dbRole || "").trim().toLowerCase()] || "user";
}

function toDbRole(uiRole) {
const map = { user: "Customer", manager: "Manager", admin: "Admin", customer: "Customer" };
return map[String(uiRole || "").trim().toLowerCase()] || "Customer";
}

/* Human-readable labels + the "different interface" each role gets. */
const ROLE_INFO = {
user: { label: "Customer", icon: "🛍️", blurb: "Shop, place orders and track parcels." },
manager: { label: "Manager / Courier", icon: "🚚", blurb: "Fulfil orders, assign routes and drivers." },
admin: { label: "Administrator", icon: "🛡️", blurb: "Manage users, roles and the audit log." }
};

permission -> roles allowed. Everything the UI shows/hides AND everything
the API checks reads from this single object, so the UI can never show an
action the API would refuse (and vice-versa).
-------------------------------------------------------------------------- /
const PERMISSIONS = {
"products": ["user", "manager", "admin"],
"cart": ["user", "manager", "admin"],
"orders": ["user", "manager", "admin"],     / place an order            /
"orders:read": ["user", "manager", "admin"],   / see MY orders             /
"orders:read": ["manager", "admin"],           / see EVERY order           /
"orders:update": ["manager", "admin"],      / move a parcel forward     /
"routes": ["manager", "admin"],             / assign route + driver     /
"users": ["admin"],                           / list all accounts         /
"users:update": ["admin"],                    / promote / demote          */
"audit": ["admin"]
};

/* The public storefront does not need a session. */
const PUBLIC_ENDPOINTS = ["products"];

/* Which backend endpoint PROVES a given permission. middleware/role.js answers
403 for a role that is not allowed, which is exactly what we surface in the
UI — the server, not the browser, makes the decision. */
const PERMISSION_ENDPOINT = {
"orders:read": "/api/customer",
"orders:read": "/api/manager",
"orders:update": "/api/manager",
"routes": "/api/manager",
"users": "/api/admin",
"users:update": "/api/admin",
"audit": "/api/admin"
};

One place that adds the bearer token and turns every non-2xx response into a
plain { ok, status, error } object, so the callers never have to deal
with Response objects or thrown exceptions.
-------------------------------------------------------------------------- */
async function apiFetch(path, { method = "GET", body, token } = {}) {
const headers = {};
if (body !== undefined) headers["Content-Type"] = "application/json";
if (token) headers["Authorization"] = Bearer ${token};

let res;
try {
    res = await fetch(API_BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
} catch (err) {
    /* fetch() only rejects on a network-level failure: the Node server is
       not running, the port is wrong, or the browser blocked the request. */
    return {
        ok: false,
        status: 0,
        error: `Cannot reach the API at ${API_BASE}. Is the Node server running? ` +
            `(cd backend/backend && npm start)`
    };
}

let data = null;
try { data = await res.json(); } catch { /* empty or non-JSON body */ }

if (!res.ok) {
    return {
        ok: false,
        status: res.status,
        error: (data && (data.message || data.error)) || `Request failed (${res.status})`,
        data
    };
}
return { ok: true, status: res.status, data };

}

/* --------------------------------------------------------------------------
4. SESSION HELPERS
-------------------------------------------------------------------------- /
/ Read the payload of the server-issued JWT (base64url) WITHOUT verifying it.
Verification happens on the server; we only look at exp so the UI can drop
a token it already knows is expired. */
function decodeJwt(token) {
try {
const part = token.split(".")[1];
const pad = part.length % 4 ? "=".repeat(4 - (part.length % 4)) : "";
const json = decodeURIComponent(escape(atob(part.replace(/-/g, "+").replace(/_/g, "/") + pad)));
return JSON.parse(json);
} catch { return null; }
}

/* The backend answers { user_id, customer_id, email, role } from /login and
/profile. Normalise it into the shape the rest of the app expects (role in
UI form, plus a display name that the API may not send). */
function normaliseUser(user) {
if (!user) return null;
return {
user_id: user.user_id,
customer_id: user.customer_id,
email: user.email,
role: toUiRole(user.role),
name: user.name || user.full_name ||
[user.first_name, user.last_name].filter(Boolean).join(" ") ||
user.email
};
}

Client-side feedback only. The real hash is computed with bcrypt on the
server (routes/auth.js), never in the browser.
-------------------------------------------------------------------------- */
function passwordProblems(password) {
const problems = [];
if (password.length < 8) problems.push("at least 8 characters");
if (!/[A-Z]/.test(password)) problems.push("one uppercase letter");
if (!/[a-z]/.test(password)) problems.push("one lowercase letter");
if (!/\d/.test(password)) problems.push("one digit");
return problems;
}

/* --------------------------------------------------------------------------
6. AUTH API  — register / login / logout / me  (all real HTTP calls)
-------------------------------------------------------------------------- */

/* POST /api/auth/register
The backend expects first_name / last_name / phone separately, while the form
only collects a full name. Split it: everything after the first word becomes
the last name; phone is optional. */
async function apiRegister({ name, email, password, phone }) {
const cleanName = (name || "").trim();
const cleanEmail = (email || "").trim().toLowerCase();

/* The same checks the form shows, so we fail fast without a round-trip. */
if (cleanName.length < 2) return { ok: false, status: 422, error: "Please enter your full name." };
if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(cleanEmail)) return { ok: false, status: 422, error: "That email address looks invalid." };

const problems = passwordProblems(password || "");
if (problems.length) return { ok: false, status: 422, error: "Password needs " + problems.join(", ") + "." };

const parts = cleanName.split(/\s+/);
const first_name = parts[0];
const last_name = parts.slice(1).join(" ") || "-";

const res = await apiFetch("/api/auth/register", {
    method: "POST",
    body: { first_name, last_name, phone: phone || null, email: cleanEmail, password }
});

if (!res.ok) {
    /* The backend answers 400 "User with this email already exists". */
    return { ok: false, status: res.status, error: res.error };
}

/* Registration does not return a token, so sign in straight away. */
const login = await apiLogin({ email: cleanEmail, password });
if (!login.ok) {
    return { ok: false, status: login.status, error: "Account created, but automatic sign-in failed. Please sign in." };
}
return login;

}

/* POST /api/auth/login -> { message, token, user } */
async function apiLogin({ email, password }) {
const cleanEmail = (email || "").trim().toLowerCase();

const res = await apiFetch("/api/auth/login", {
    method: "POST",
    body: { email: cleanEmail, password }
});

if (!res.ok) {
    return {
        ok: false,
        status: res.status,
        /* 401 is the backend's "Invalid email or password". */
        error: res.status === 401 ? "Wrong email or password." : res.error
    };
}

const { token, user } = res.data;
return {
    ok: true,
    status: 200,
    token,
    user: normaliseUser(user),
    session_id: decodeJwt(token)?.jti || null
};

}

/* The backend has no logout route: the token is stateless, so signing out is
purely a client-side act (drop the token). Kept async and object-returning so
main.js did not have to change. */
async function apiLogout() {
return { ok: true, status: 200 };
}

/* GET /api/profile — "who am I?" (the token is verified by the server). */
async function apiMe(token) {
if (!token) return { ok: false, status: 401, error: "No session token." };

/* Cheap local check first: never call the API with a token we already know
   has expired. */
const payload = decodeJwt(token);
if (payload?.exp && payload.exp * 1000 < Date.now()) {
    return { ok: false, status: 401, error: "Session expired." };
}

const res = await apiFetch("/api/profile", { token });
if (!res.ok) return { ok: false, status: res.status, error: res.error };

return { ok: true, status: 200, user: normaliseUser(res.data.user), session: payload };

}

requireAuth("orders:read")(token) asks the BACKEND endpoint that proves
the permission. A Customer calling the admin endpoint gets a real 403 from
middleware/role.js — which is exactly what the workspace shows.
-------------------------------------------------------------------------- */
function requireAuth(permission) {
return async function (token) {
if (PUBLIC_ENDPOINTS.includes(permission)) {
return { ok: true, status: 200, user: null };
}

    /* First establish who the caller is (401 if the token is bad/expired). */
    const me = await apiMe(token);
    if (!me.ok) return me;

    const endpoint = PERMISSION_ENDPOINT[permission];

    /* No dedicated endpoint for this permission (e.g. orders:create): fall
       back to the matrix. The UI still cannot escalate — every real mutation
       is sent to the server, which re-checks the role from the token. */
    if (!endpoint) {
        const allowed = PERMISSIONS[permission] || [];
        if (!allowed.includes(me.user.role)) {
            return {
                ok: false,
                status: 403,
                error: `Forbidden — "${permission}" requires ${allowed.join(" / ")}, you are ${me.user.role}.`,
                requiredRoles: allowed,
                yourRole: me.user.role
            };
        }
        return { ok: true, status: 200, user: me.user, session: me.session };
    }

    /* Ask the server: a role that is not allowed gets 403 from the API. */
    const check = await apiFetch(endpoint, { token });
    if (!check.ok) {
        return {
            ok: false,
            status: check.status,
            error: check.status === 403
                ? `Forbidden — "${permission}" is not allowed for the ${me.user.role} role.`
                : check.error,
            yourRole: me.user.role
        };
    }
    return { ok: true, status: 200, user: me.user, session: me.session, data: check.data };
};

}

/* Small helper used by the UI to grey-out buttons the current role can't use. */
function can(role, permission) {
if (PUBLIC_ENDPOINTS.includes(permission)) return true;
return (PERMISSIONS[permission] || []).includes(role);
}

Accounts now live in PostgreSQL, created by the backend. These are the three
the UI's one-click buttons offer — they must exist in the users table with
the matching bcrypt hash and role. See the SQL in the summary to insert them.
-------------------------------------------------------------------------- */
const SEED_ACCOUNTS = [
{ name: "Alice Customer", email: "user@gamazon.dev", password: "User1234", role: "user" },
{ name: "Marco Manager", email: "manager@gamazon.dev", password: "Manager1234", role: "manager" },
{ name: "Ada Admin", email: "admin@gamazon.dev", password: "Admin1234", role: "admin" }
];

/* main.js awaits Auth.seeded before relying on the password form. Nothing is
hashed in the browser any more, so this resolves immediately. */
const seeded = Promise.resolve(true);

/* Kept so the demo UI can call seedUsers() without a ReferenceError. */
async function seedUsers() { return true; }

Auth is what main.js and the browser console use. Every call below now
performs a real HTTP request against the Express API:

   await Auth.login({ email: "user@gamazon.dev", password: "User1234" })
   await Auth.me(token)
   await Auth.requireAuth("users:read")(token)   -> 403 for a Customer

-------------------------------------------------------------------------- */
const Auth = {
API_BASE,
ROLES, ROLE_INFO, PERMISSIONS, PUBLIC_ENDPOINTS,
SEED_ACCOUNTS,
seeded,
register: apiRegister,
login: apiLogin,
logout: apiLogout,
me: apiMe,
requireAuth,
can,
passwordProblems,
toUiRole,
toDbRole,
normaliseUser,
decodeJwt,
fetch: apiFetch
};

window.Auth = Auth;
