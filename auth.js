console.log("NEW AUTH JS LOADED - 2026");
const API_BASE = "http://localhost:3000";

const ROLES = [
    { role_id: 1, role_name: "user" },
    { role_id: 2, role_name: "manager" },
    { role_id: 3, role_name: "admin" }
];

function toUiRole(dbRole) {
    const map = {
        customer: "user",
        manager: "manager",
        admin: "admin",
        user: "user"
    };
    return map[String(dbRole || "").trim().toLowerCase()] || "user";
}

function toDbRole(uiRole) {
    const map = {
        user: "Customer",
        manager: "Manager",
        admin: "Admin",
        customer: "Customer"
    };
    return map[String(uiRole || "").trim().toLowerCase()] || "Customer";
}

const ROLE_INFO = {
    user: {
        label: "Customer",
        icon: "🛍️",
        blurb: "Shop, place orders and track parcels."
    },
    manager: {
        label: "Manager / Courier",
        icon: "🚚",
        blurb: "Fulfil orders, assign routes and drivers."
    },
    admin: {
        label: "Administrator",
        icon: "🛡️",
        blurb: "Manage users, roles and the audit log."
    }
};

const PERMISSIONS = {
    "products:read": ["user", "manager", "admin"],
    "cart:manage": ["user", "manager", "admin"],
    "orders:create": ["user", "manager", "admin"],
    "orders:read:own": ["user", "manager", "admin"],
    "orders:read:all": ["manager", "admin"],
    "orders:update:status": ["manager", "admin"],
    "routes:manage": ["manager", "admin"],
    "users:read": ["admin"],
    "users:update:role": ["admin"],
    "audit:read": ["admin"]
};

const PUBLIC_ENDPOINTS = ["products:read"];

const PERMISSION_ENDPOINT = {
    "orders:read:own": "/api/customer",
    "orders:read:all": "/api/manager",
    "orders:update:status": "/api/manager",
    "routes:manage": "/api/manager",
    "users:read": "/api/admin",
    "users:update:role": "/api/admin",
    "audit:read": "/api/admin"
};

async function apiFetch(path, {
    method = "GET",
    body,
    token
} = {}) {
    const headers = {};

    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
    }

    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    let res;

    try {
        res = await fetch(API_BASE + path, {
            method,
            headers,
            body: body === undefined
                ? undefined
                : JSON.stringify(body)
        });
    } catch (err) {
        return {
            ok: false,
            status: 0,
            error:
                `Cannot reach the API at ${API_BASE}. ` +
                `Is the Node server running?`
        };
    }

    let data = null;

    try {
        data = await res.json();
    } catch {}

    if (!res.ok) {
        return {
            ok: false,
            status: res.status,
            error:
                (data && (data.message || data.error)) ||
                `Request failed (${res.status})`,
            data
        };
    }

    return {
        ok: true,
        status: res.status,
        data
    };
}

function decodeJwt(token) {
    try {
        const part = token.split(".")[1];

        const pad =
            part.length % 4
                ? "=".repeat(4 - (part.length % 4))
                : "";

        const base64 =
            part
                .replace(/-/g, "+")
                .replace(/_/g, "/") + pad;

        const json = decodeURIComponent(
            escape(atob(base64))
        );

        return JSON.parse(json);
    } catch {
        return null;
    }
}

function normaliseUser(user) {
    if (!user) return null;

    return {
        user_id: user.user_id,
        customer_id: user.customer_id,
        email: user.email,
        role: toUiRole(user.role),

        name:
            user.name ||
            user.full_name ||
            [user.first_name, user.last_name]
                .filter(Boolean)
                .join(" ") ||
            user.email
    };
}

function passwordProblems(password) {
    const problems = [];

    if (password.length < 8) {
        problems.push("at least 8 characters");
    }

    if (!/[A-Z]/.test(password)) {
        problems.push("one uppercase letter");
    }

    if (!/[a-z]/.test(password)) {
        problems.push("one lowercase letter");
    }

    if (!/\d/.test(password)) {
        problems.push("one digit");
    }

    return problems;
}

async function apiRegister({
    name,
    email,
    password,
    phone
}) {
    const cleanName = (name || "").trim();
    const cleanEmail = (email || "")
        .trim()
        .toLowerCase();

    if (cleanName.length < 2) {
        return {
            ok: false,
            status: 422,
            error: "Please enter your full name."
        };
    }

    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(cleanEmail)) {
        return {
            ok: false,
            status: 422,
            error: "That email address looks invalid."
        };
    }

    const problems = passwordProblems(password || "");

    if (problems.length) {
        return {
            ok: false,
            status: 422,
            error:
                "Password needs " +
                problems.join(", ") +
                "."
        };
    }

    const parts = cleanName.split(/\s+/);

    const first_name = parts[0];

    const last_name =
        parts.slice(1).join(" ") || "-";

    const res = await apiFetch(
        "/api/auth/register",
        {
            method: "POST",
            body: {
                first_name,
                last_name,
                phone: phone || null,
                email: cleanEmail,
                password
            }
        }
    );

    if (!res.ok) {
        return {
            ok: false,
            status: res.status,
            error: res.error
        };
    }

    return await apiLogin({
        email: cleanEmail,
        password
    });
}

async function apiLogin({
    email,
    password
}) {
    const cleanEmail = (email || "")
        .trim()
        .toLowerCase();

    const res = await apiFetch(
        "/api/auth/login",
        {
            method: "POST",
            body: {
                email: cleanEmail,
                password
            }
        }
    );

    if (!res.ok) {
        return {
            ok: false,
            status: res.status,
            error:
                res.status === 401
                    ? "Wrong email or password."
                    : res.error
        };
    }

    const token = res.data.token;
    const user = res.data.user;

    return {
        ok: true,
        status: 200,
        token,
        user: normaliseUser(user),
        session_id:
            decodeJwt(token)?.jti || null
    };
}

async function apiLogout() {
    return {
        ok: true,
        status: 200
    };
}

async function apiMe(token) {
    if (!token) {
        return {
            ok: false,
            status: 401,
            error: "No session token."
        };
    }

    const payload = decodeJwt(token);

    if (
        payload?.exp &&
        payload.exp * 1000 < Date.now()
    ) {
        return {
            ok: false,
            status: 401,
            error: "Session expired."
        };
    }

    const res = await apiFetch(
        "/api/profile",
        { token }
    );

    if (!res.ok) {
        return {
            ok: false,
            status: res.status,
            error: res.error
        };
    }

    return {
        ok: true,
        status: 200,
        user: normaliseUser(res.data.user),
        session: payload
    };
}

function requireAuth(permission) {
    return async function(token) {

        if (
            PUBLIC_ENDPOINTS.includes(
                permission
            )
        ) {
            return {
                ok: true,
                status: 200,
                user: null
            };
        }

        const me = await apiMe(token);

        if (!me.ok) {
            return me;
        }

        const endpoint =
            PERMISSION_ENDPOINT[permission];

        if (!endpoint) {

            const allowed =
                PERMISSIONS[permission] || [];

            if (!allowed.includes(me.user.role)) {
                return {
                    ok: false,
                    status: 403,
                    error:
                        `Forbidden — "${permission}" ` +
                        `requires ${allowed.join(" / ")}, ` +
                        `you are ${me.user.role}.`
                };
            }

            return {
                ok: true,
                status: 200,
                user: me.user,
                session: me.session
            };
        }

        const check = await apiFetch(
            endpoint,
            { token }
        );

        if (!check.ok) {
            return {
                ok: false,
                status: check.status,
                error:
                    check.status === 403
                        ? `Forbidden — "${permission}" ` +
                          `is not allowed for the ` +
                          `${me.user.role} role.`
                        : check.error,
                yourRole: me.user.role
            };
        }

        return {
            ok: true,
            status: 200,
            user: me.user,
            session: me.session,
            data: check.data
        };
    };
}

function can(role, permission) {
    if (
        PUBLIC_ENDPOINTS.includes(
            permission
        )
    ) {
        return true;
    }

    return (
        PERMISSIONS[permission] || []
    ).includes(role);
}

const SEED_ACCOUNTS = [
    {
        name: "Alice Customer",
        email: "user@gamazon.dev",
        password: "User1234",
        role: "user"
    },
    {
        name: "Marco Manager",
        email: "manager@gamazon.dev",
        password: "Manager1234",
        role: "manager"
    },
    {
        name: "Ada Admin",
        email: "admin@gamazon.dev",
        password: "Admin1234",
        role: "admin"
    }
];

const seeded = Promise.resolve(true);

async function seedUsers() {
    return true;
}

const Auth = {
    API_BASE,

    ROLES,
    ROLE_INFO,
    PERMISSIONS,
    PUBLIC_ENDPOINTS,

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
