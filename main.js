/* ==========================================================================
   GAmazon — Logistics & Delivery System
   --------------------------------------------------------------------------
   A customer-facing storefront for a logistics and delivery project: browse
   products, add to cart, checkout, and then track the parcel through the
   delivery chain (depot -> route -> driver/vehicle -> doorstep).

   Under the hood everything is modelled as relational "tables" (PRODUCTS,
   CART, ORDERS, ORDER_ITEMS, CUSTOMERS, TRACKING_EVENTS) and the UI only
   talks to them through small query-like functions, so the database design is
   used — just never shown to the shopper.
   ========================================================================== */

/* --------------------------------------------------------------------------
   DATA LAYER — the "database"
   -------------------------------------------------------------------------- */

/* PRODUCTS table: every item for sale. */
const PRODUCTS = [
    { id: "P-101", name: "Aurora Wireless Headphones", category: "Electronics", price: 89.99, rating: 4.6, reviews: 1284, emoji: "🎧", badge: "Best seller" },
    { id: "P-102", name: "Nova Running Shoes", category: "Fashion", price: 64.50, rating: 4.4, reviews: 862, emoji: "👟", badge: "" },
    { id: "P-103", name: "Atlas Espresso Coffee Maker", category: "Home", price: 129.00, rating: 4.7, reviews: 540, emoji: "☕", badge: "Top rated" },
    { id: "P-104", name: "Pulse Smart Watch Series 5", category: "Electronics", price: 149.99, rating: 4.5, reviews: 2031, emoji: "⌚", badge: "" },
    { id: "P-105", name: "Cloud 9 Memory Foam Pillow", category: "Home", price: 24.99, rating: 4.3, reviews: 410, emoji: "🛏️", badge: "" },
    { id: "P-106", name: "Trailblazer Hiking Backpack", category: "Fashion", price: 54.00, rating: 4.6, reviews: 733, emoji: "🎒", badge: "" },
    { id: "P-107", name: "Lumen LED Desk Lamp", category: "Home", price: 32.75, rating: 4.2, reviews: 268, emoji: "💡", badge: "" },
    { id: "P-108", name: "Echo Portable Bluetooth Speaker", category: "Electronics", price: 45.99, rating: 4.4, reviews: 1120, emoji: "🔊", badge: "Deal" },
    { id: "P-109", name: "Vista Polarized Sunglasses", category: "Fashion", price: 39.99, rating: 4.1, reviews: 189, emoji: "🕶️", badge: "" },
    { id: "P-110", name: "BrewMaster French Press", category: "Home", price: 27.50, rating: 4.5, reviews: 356, emoji: "🫖", badge: "" },
    { id: "P-111", name: "Quantum Mechanical Keyboard", category: "Electronics", price: 74.99, rating: 4.8, reviews: 905, emoji: "⌨️", badge: "New" },
    { id: "P-112", name: "Cozy Knit Winter Scarf", category: "Fashion", price: 18.99, rating: 4.0, reviews: 142, emoji: "🧣", badge: "" }
];

/* CART table: product_id -> quantity. One row per product added. */
let CART = [];

/* CUSTOMERS table. */
const CUSTOMERS = [];

/* --------------------------------------------------------------------------
   AUTH SESSION (Week 5) — the UI mirror of the signed token
   --------------------------------------------------------------------------
   `SESSION` is the client-side copy of what the server told us at login:
   { token, user:{user_id,name,email,role} }. The token is a signed JWT kept in
   localStorage so a refresh keeps you signed in; it is re-verified through
   Auth.me() on every page load, and any role/permission decision goes through
   Auth.requireAuth(...) — never through this object alone.
   -------------------------------------------------------------------------- */
const SESSION_KEY = "gamazon.session";
let SESSION = null;

/* ORDERS table: each checkout creates a row. */
const ORDERS = [];

/* ORDER_ITEMS table: order_id -> product snapshot + qty. */
const ORDER_ITEMS = [];

/* TRACKING_EVENTS table: order_id -> sequence of delivery updates. */
const TRACKING_EVENTS = [];

/* Auto-increment counters (mimic AUTO_INCREMENT primary keys). */
let nextCustomerId = 1;
let nextOrderNumber = 104832;

/* --------------------------------------------------------------------------
   QUERY-LIKE HELPERS — the "API" the UI calls
   -------------------------------------------------------------------------- */

/* SELECT * FROM products WHERE category = ? AND name LIKE ? */
function queryProducts({ category = "All", search = "" } = {}) {
    const term = search.trim().toLowerCase();
    return PRODUCTS.filter(p => {
        const catOk = category === "All" || p.category === category;
        const searchOk = !term || p.name.toLowerCase().includes(term) || p.category.toLowerCase().includes(term);
        return catOk && searchOk;
    });
}

/* SELECT * FROM products WHERE product_id = ? */
function getProduct(id) {
    return PRODUCTS.find(p => p.id === id);
}

/* SELECT categories (DISTINCT) */
function getCategories() {
    return ["All", ...new Set(PRODUCTS.map(p => p.category))];
}

/* INSERT / UPDATE CART for a product, then return the new quantity. */
function addToCart(productId, qty = 1) {
    const row = CART.find(r => r.product_id === productId);
    if (row) {
        row.quantity += qty;
    } else {
        CART.push({ product_id: productId, quantity: qty });
    }
    return CART.find(r => r.product_id === productId).quantity;
}

/* UPDATE CART quantity (DELETE when it hits zero). */
function setCartQty(productId, qty) {
    const row = CART.find(r => r.product_id === productId);
    if (!row) return;
    if (qty <= 0) {
        CART = CART.filter(r => r.product_id !== productId);
    } else {
        row.quantity = qty;
    }
}

/* DELETE FROM cart WHERE product_id = ? */
function removeFromCart(productId) {
    CART = CART.filter(r => r.product_id !== productId);
}

/* JOIN cart rows with products, plus the computed subtotal. */
function getCartDetailed() {
    const lines = CART.map(row => {
        const product = getProduct(row.product_id);
        return { ...product, quantity: row.quantity, lineTotal: product.price * row.quantity };
    });
    const count = lines.reduce((n, l) => n + l.quantity, 0);
    const subtotal = lines.reduce((n, l) => n + l.lineTotal, 0);
    return { lines, count, subtotal };
}

/* INSERT a customer (only if the email is new) and return their id. */
function upsertCustomer({ name, email, address }) {
    const existing = CUSTOMERS.find(c => c.email === email);
    if (existing) {
        existing.name = name;
        existing.address = address;
        return existing.customer_id;
    }
    const customer = { customer_id: nextCustomerId++, name, email, address };
    CUSTOMERS.push(customer);
    return customer.customer_id;
}

/* Link the logged-in account to its CUSTOMERS row, so "My orders" can be
   filtered by customer_id (the FK that the auth layer adds to the design). */
function upsertAccountCustomer({ name, email, address }) {
    const customerId = upsertCustomer({ name, email, address });
    if (SESSION) {
        SESSION.user.customer_id = customerId;
        persistSession();
    }
    return customerId;
}

/* SELECT * FROM orders WHERE customer_id = ? */
function getOrdersByCustomer(customerId) {
    return ORDERS.filter(o => o.customer_id === customerId);
}

/* UPDATE orders SET order_status = ? WHERE order_id = ? (+ a tracking event). */
function updateOrderStatus(orderId, status, note) {
    const order = ORDERS.find(o => o.order_id === orderId);
    if (!order) return null;
    order.order_status = status;
    TRACKING_EVENTS.push({
        order_id: orderId,
        title: status,
        time: new Date().toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }),
        desc: note || "Status updated by the fulfilment team."
    });
    return order;
}

/* INSERT an order + its items + tracking events. Returns the order number. */
function createOrder({ customerId, address, lines }) {
    const orderNumber = "GA-" + nextOrderNumber++;
    const total = lines.reduce((n, l) => n + l.lineTotal, 0);

    ORDERS.push({
        order_id: orderNumber,
        customer_id: customerId,
        address,
        order_date: new Date(),
        order_status: "Order placed",
        total
    });

    lines.forEach(l => {
        ORDER_ITEMS.push({ order_id: orderNumber, product_id: l.id, name: l.name, quantity: l.quantity, price: l.price });
    });

    seedTracking(orderNumber, lines);
    return orderNumber;
}

/* SELECT * FROM orders WHERE order_id = ? (with customer + items joined). */
function getOrder(orderId) {
    const order = ORDERS.find(o => o.order_id === orderId.trim().toUpperCase());
    if (!order) return null;
    const customer = CUSTOMERS.find(c => c.customer_id === order.customer_id);
    const items = ORDER_ITEMS.filter(i => i.order_id === order.order_id);
    const events = TRACKING_EVENTS.filter(e => e.order_id === order.order_id);
    return { order, customer, items, events };
}

/* --------------------------------------------------------------------------
   TRACKING — build the delivery timeline for a new order
   -------------------------------------------------------------------------- */
const LIFECYCLE = ["Order placed", "Parcel created", "Assigned to route", "Out for delivery", "Delivered"];

function seedTracking(orderId, lines) {
    const itemCount = lines.reduce((n, l) => n + l.quantity, 0);
    const now = new Date();
    const time = d => d.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });

    /* A brand-new order has reached the first two stages. */
    TRACKING_EVENTS.push({ order_id: orderId, title: "Order placed", time: time(now), desc: `We received your order for ${itemCount} item${itemCount > 1 ? "s" : ""}.` });
    TRACKING_EVENTS.push({ order_id: orderId, title: "Parcel created", time: time(now), desc: "Your items were packed and a parcel was created at the depot." });
}

/* --------------------------------------------------------------------------
   UI — RENDER PRODUCTS
   -------------------------------------------------------------------------- */
const productGrid = document.getElementById("productGrid");
const categoryChips = document.getElementById("categoryChips");
const searchInput = document.getElementById("searchInput");
const emptyMsg = document.getElementById("emptyMsg");

let activeCategory = "All";

function renderChips() {
    categoryChips.innerHTML = "";
    getCategories().forEach(cat => {
        const btn = document.createElement("button");
        btn.className = "chip" + (cat === activeCategory ? " active" : "");
        btn.textContent = cat;
        btn.addEventListener("click", () => {
            activeCategory = cat;
            renderChips();
            renderProducts();
        });
        categoryChips.appendChild(btn);
    });
}

function stars(rating) {
    const full = Math.round(rating);
    return "★".repeat(full) + "☆".repeat(5 - full);
}

function renderProducts() {
    const items = queryProducts({ category: activeCategory, search: searchInput.value });
    productGrid.innerHTML = "";
    emptyMsg.hidden = items.length > 0;

    items.forEach(p => {
        const card = document.createElement("article");
        card.className = "product";
        card.innerHTML = `
            <div class="product-media">
                ${p.badge ? `<span class="product-badge">${p.badge}</span>` : ""}
                <span aria-hidden="true">${p.emoji}</span>
            </div>
            <div class="product-body">
                <span class="product-cat">${p.category}</span>
                <h3 class="product-name">${p.name}</h3>
                <div class="product-rating">${stars(p.rating)} <span>(${p.reviews})</span></div>
                <div class="product-foot">
                    <span class="product-price">$${p.price.toFixed(2)}<small>incl. tax</small></span>
                    <button class="add-btn" data-id="${p.id}">Add</button>
                </div>
            </div>
        `;
        card.querySelector(".add-btn").addEventListener("click", e => handleAdd(e.target, p.id));
        productGrid.appendChild(card);
    });
}

function handleAdd(btn, productId) {
    addToCart(productId);
    renderCart();
    btn.textContent = "Added ✓";
    btn.classList.add("added");
    setTimeout(() => {
        btn.textContent = "Add";
        btn.classList.remove("added");
    }, 900);
    toast("Added to cart");
}

/* --------------------------------------------------------------------------
   UI — CART DRAWER
   -------------------------------------------------------------------------- */
const cartDrawer = document.getElementById("cartDrawer");
const drawerOverlay = document.getElementById("drawerOverlay");
const cartBody = document.getElementById("cartBody");
const cartCount = document.getElementById("cartCount");
const cartTotal = document.getElementById("cartTotal");
const cartShip = document.getElementById("cartShip");
const checkoutBtn = document.getElementById("checkoutBtn");

function openCart() {
    cartDrawer.classList.add("open");
    cartDrawer.setAttribute("aria-hidden", "false");
    drawerOverlay.hidden = false;
}

function closeCart() {
    cartDrawer.classList.remove("open");
    cartDrawer.setAttribute("aria-hidden", "true");
    drawerOverlay.hidden = true;
}

function renderCart() {
    const { lines, count, subtotal } = getCartDetailed();

    cartCount.textContent = count;
    cartTotal.textContent = "$" + subtotal.toFixed(2);

    if (count === 0) {
        cartBody.innerHTML = `<div class="cart-empty"><span>🛒</span>Your cart is empty.<br>Add something you love!</div>`;
        cartShip.textContent = "";
        checkoutBtn.disabled = true;
        checkoutBtn.style.opacity = 0.5;
        return;
    }

    checkoutBtn.disabled = false;
    checkoutBtn.style.opacity = 1;

    const FREE_LIMIT = 25;
    cartShip.textContent = subtotal >= FREE_LIMIT
        ? "✓ You've qualified for free delivery"
        : `Add $${(FREE_LIMIT - subtotal).toFixed(2)} more for free delivery`;

    cartBody.innerHTML = "";
    lines.forEach(l => {
        const row = document.createElement("div");
        row.className = "cart-item";
        row.innerHTML = `
            <div class="cart-item-emoji">${l.emoji}</div>
            <div class="cart-item-info">
                <h4>${l.name}</h4>
                <p>$${l.price.toFixed(2)} each</p>
                <div class="qty-controls">
                    <button class="qty-btn" data-act="dec" data-id="${l.id}">−</button>
                    <span class="qty-value">${l.quantity}</span>
                    <button class="qty-btn" data-act="inc" data-id="${l.id}">+</button>
                </div>
                <button class="remove-btn" data-act="remove" data-id="${l.id}">Remove</button>
            </div>
            <div class="cart-item-price">$${l.lineTotal.toFixed(2)}</div>
        `;
        cartBody.appendChild(row);
    });

    cartBody.querySelectorAll("[data-act]").forEach(btn => {
        btn.addEventListener("click", () => {
            const { act, id } = btn.dataset;
            const current = CART.find(r => r.product_id === id)?.quantity || 0;
            if (act === "inc") setCartQty(id, current + 1);
            if (act === "dec") setCartQty(id, current - 1);
            if (act === "remove") removeFromCart(id);
            renderCart();
        });
    });
}

/* --------------------------------------------------------------------------
   UI — CHECKOUT + CONFIRMATION
   -------------------------------------------------------------------------- */
const checkoutOverlay = document.getElementById("checkoutOverlay");
const checkoutStep = document.getElementById("checkoutStep");
const confirmStep = document.getElementById("confirmStep");
const checkoutForm = document.getElementById("checkoutForm");
const checkoutSummary = document.getElementById("checkoutSummary");
const modalTitle = document.getElementById("modalTitle");

function openCheckout() {
    const { count, subtotal } = getCartDetailed();
    if (count === 0) return;
    checkoutSummary.textContent = `${count} item${count > 1 ? "s" : ""} · total $${subtotal.toFixed(2)}`;
    checkoutStep.hidden = false;
    confirmStep.hidden = true;
    modalTitle.textContent = "Checkout";
    checkoutOverlay.hidden = false;
    syncCheckoutAuth();
    closeCart();
}

/* Placing an order is a PROTECTED action (orders:create). If nobody is signed
   in we show the lock panel instead of the form. */
function syncCheckoutAuth() {
    const gate = document.getElementById("checkoutGate");
    const form = document.getElementById("checkoutForm");
    const badge = document.getElementById("signedBadge");
    const signedIn = !!SESSION;

    gate.hidden = signedIn;
    form.hidden = !signedIn;
    if (!signedIn) return;

    const u = SESSION.user;
    badge.hidden = false;
    badge.textContent = `Signed in as ${u.name} · ${ROLE_LABEL(u.role)}`;
    document.getElementById("fName").value = u.name;
    document.getElementById("fEmail").value = u.email;
}

function closeCheckout() {
    checkoutOverlay.hidden = true;
    /* Return the modal to the checkout step so reopening never shows a stale
       confirmation screen from a previous order. */
    checkoutStep.hidden = false;
    confirmStep.hidden = true;
    modalTitle.textContent = "Checkout";
}

checkoutForm.addEventListener("submit", async e => {
    e.preventDefault();

    /* --- GUARD: the token must still be valid and carry orders:create --- */
    const guard = await Auth.requireAuth("orders:create")(SESSION?.token);
    if (!guard.ok) {
        toast(guard.error);
        syncCheckoutAuth();
        return;
    }

    const name = guard.user.name;
    const email = guard.user.email;
    const address = document.getElementById("fAddress").value.trim();

    const { lines } = getCartDetailed();
    /* The order is tied to the authenticated account, not to a typed-in email. */
    const customerId = upsertAccountCustomer({ name, email, address });
    const orderNumber = createOrder({ customerId, address, lines });

    /* Empty the cart once the order is saved. */
    CART = [];
    renderCart();
    renderWorkspace();

    /* Show confirmation. */
    document.getElementById("confirmName").textContent = name.split(" ")[0] || "shopper";
    document.getElementById("confirmAddress").textContent = address;
    document.getElementById("confirmOrderId").textContent = orderNumber;
    checkoutStep.hidden = true;
    confirmStep.hidden = false;
    modalTitle.textContent = "Order confirmed";

    /* Remember this order so "Track this order" can jump straight to it. */
    checkoutOverlay.dataset.lastOrder = orderNumber;
    checkoutForm.reset();
    document.getElementById("fAddress").value = "";
    syncCheckoutAuth();
});

document.getElementById("viewTrackingBtn").addEventListener("click", () => {
    const orderNumber = checkoutOverlay.dataset.lastOrder;
    closeCheckout();
    document.getElementById("orderInput").value = orderNumber;
    document.getElementById("track").scrollIntoView({ behavior: "smooth" });
    trackOrder();
});

document.getElementById("continueBtn").addEventListener("click", () => {
    closeCheckout();
    document.getElementById("shop").scrollIntoView({ behavior: "smooth" });
});

/* --------------------------------------------------------------------------
   UI — ORDER TRACKING
   -------------------------------------------------------------------------- */
const orderInput = document.getElementById("orderInput");
const trackBtn = document.getElementById("trackBtn");
const metaEl = document.getElementById("orderMeta");
const timelineEl = document.getElementById("timeline");

function renderMeta({ order, customer, items }) {
    const itemText = items.map(i => `${i.quantity}× ${i.name}`).join(", ");
    metaEl.innerHTML = `
        <div class="meta-row"><span>Order</span><span>${order.order_id}</span></div>
        <div class="meta-row"><span>Placed by</span><span>${customer ? customer.name : "Guest"}</span></div>
        <div class="meta-row"><span>Items</span><span>${itemText}</span></div>
        <div class="meta-row"><span>Deliver to</span><span>${order.address}</span></div>
        <div class="meta-row"><span>Total</span><span>$${order.total.toFixed(2)}</span></div>
        <div class="meta-row"><span>Status</span><span>${order.order_status}</span></div>
    `;
}

function renderTimeline(events) {
    const reached = events.length;
    timelineEl.classList.remove("has-empty");
    timelineEl.innerHTML = "";

    events.forEach((ev, i) => {
        const isLast = i === reached - 1;
        const state = isLast ? "active" : "done";
        timelineEl.insertAdjacentHTML("beforeend", `
            <div class="tl-item ${state}" style="animation-delay:${i * 70}ms">
                <div class="tl-title">${ev.title}</div>
                <div class="tl-time">${ev.time}</div>
                <div class="tl-desc">${ev.desc}</div>
            </div>
        `);
    });

    const remaining = LIFECYCLE.length - reached;
    for (let i = 0; i < remaining; i++) {
        timelineEl.insertAdjacentHTML("beforeend", `
            <div class="tl-item pending">
                <div class="tl-title">${LIFECYCLE[reached + i]}</div>
                <div class="tl-time">pending</div>
                <div class="tl-desc">We'll update you as soon as this stage is reached.</div>
            </div>
        `);
    }
}

function showTrackingPlaceholder(message) {
    timelineEl.classList.add("has-empty");
    timelineEl.innerHTML = `<div class="tl-empty">${message}</div>`;
}

function trackOrder() {
    const id = orderInput.value.trim();
    if (!id) {
        toast("Please enter an order number");
        return;
    }
    const result = getOrder(id);
    if (!result) {
        metaEl.innerHTML = "";
        showTrackingPlaceholder(`We couldn't find order <strong>${id}</strong>.<br>Check the number and try again.`);
        return;
    }
    renderMeta(result);
    renderTimeline(result.events);
}

/* --------------------------------------------------------------------------
   UI — WIRING
   -------------------------------------------------------------------------- */
document.getElementById("openCart").addEventListener("click", openCart);
document.getElementById("closeCart").addEventListener("click", closeCart);
drawerOverlay.addEventListener("click", closeCart);
checkoutBtn.addEventListener("click", openCheckout);
document.getElementById("closeCheckout").addEventListener("click", closeCheckout);
checkoutOverlay.addEventListener("click", e => {
    if (e.target === checkoutOverlay) closeCheckout();
});
document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeCart(); closeCheckout(); }
});

trackBtn.addEventListener("click", trackOrder);
orderInput.addEventListener("keydown", e => { if (e.key === "Enter") trackOrder(); });

document.querySelectorAll(".linky[data-demo]").forEach(btn => {
    btn.addEventListener("click", () => {
        orderInput.value = btn.dataset.demo;
        trackOrder();
    });
});

searchInput.addEventListener("input", renderProducts);

document.querySelectorAll(".nav-links [data-cat]").forEach(link => {
    link.addEventListener("click", () => {
        activeCategory = link.dataset.cat;
        searchInput.value = "";
        renderChips();
        renderProducts();
    });
});

/* Toast helper */
let toastTimer;
function toast(message) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.classList.remove("show");
        setTimeout(() => { el.hidden = true; }, 250);
    }, 1600);
}

/* --------------------------------------------------------------------------
   SEED DEMO ORDERS — so tracking works before you've bought anything
   -------------------------------------------------------------------------- */
function seedDemoOrders() {
    const demos = [
        {
            order_id: "GA-104832", address: "14 Birch Lane, Northgate", total: 89.99,
            items: [{ product_id: "P-101", name: "Aurora Wireless Headphones", quantity: 1, price: 89.99 }],
            events: [
                { title: "Order placed", time: "Mon 08:12", desc: "We received your order." },
                { title: "Parcel created", time: "Mon 09:40", desc: "Your parcel was packed at the Northgate depot." },
                { title: "Assigned to route RT-04", time: "Tue 06:05", desc: "Your parcel was added to today's delivery run." },
                { title: "Out for delivery", time: "Tue 09:30", desc: "The parcel is on the road to 14 Birch Lane." }
            ],
            status: "Out for delivery"
        },
        {
            order_id: "GA-104840", address: "88 Harbour Road, Riverside", total: 129.00,
            items: [{ product_id: "P-103", name: "Atlas Espresso Coffee Maker", quantity: 1, price: 129.00 }],
            events: [
                { title: "Order placed", time: "Sun 17:45", desc: "We received your order." },
                { title: "Parcel created", time: "Sun 18:20", desc: "Your parcel was packed (4.2 kg)." },
                { title: "Assigned to route RT-01", time: "Mon 06:00", desc: "Grouped into route RT-01 with 6 other orders." },
                { title: "Out for delivery", time: "Mon 08:50", desc: "Left the Riverside depot on vehicle VH-03." },
                { title: "Delivered", time: "Mon 12:36", desc: "Signed for at 88 Harbour Road. Enjoy!" }
            ],
            status: "Delivered"
        }
    ];

    demos.forEach(d => {
        const customer = { customer_id: nextCustomerId++, name: "GAmazon Shopper", email: `demo${nextCustomerId}@example.com`, address: d.address };
        CUSTOMERS.push(customer);
        ORDERS.push({
            order_id: d.order_id, customer_id: customer.customer_id, address: d.address,
            order_date: new Date(), order_status: d.status, total: d.total
        });
        d.items.forEach(i => ORDER_ITEMS.push({ order_id: d.order_id, ...i }));
        d.events.forEach(e => TRACKING_EVENTS.push({ order_id: d.order_id, ...e }));
    });
}

/* ==========================================================================
   AUTH UI + ROLE WORKSPACE (Week 5)
   ========================================================================== */
const authOverlay = document.getElementById("authOverlay");
const authTitle = document.getElementById("authTitle");
const authMsg = document.getElementById("authMsg");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");

const ROLE_LABEL = role => Auth.ROLE_INFO[role]?.label || role;
const ROLE_ICON = role => Auth.ROLE_INFO[role]?.icon || "👤";

/* ---- session persistence (localStorage, token verified on load) ---- */
function persistSession() {
    try {
        if (SESSION) localStorage.setItem(SESSION_KEY, JSON.stringify(SESSION));
        else localStorage.removeItem(SESSION_KEY);
    } catch (err) {
        /* localStorage can be blocked (private mode / file:// restrictions).
           Sign-in still works for this page load — only "remember me" is lost. */
        console.warn("Could not persist the session:", err.message);
    }
}

function loadStoredSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

/* ---- auth modal ---- */
function openAuth(tab = "login") {
    switchAuthTab(tab);
    authMsg.hidden = true;
    authOverlay.hidden = false;
    closeCheckout();
}

function closeAuth() { authOverlay.hidden = true; }

function switchAuthTab(tab) {
    document.querySelectorAll("[data-auth-tab]").forEach(b =>
        b.classList.toggle("active", b.dataset.authTab === tab));
    loginForm.hidden = tab !== "login";
    registerForm.hidden = tab !== "register";
    authTitle.textContent = tab === "login" ? "Sign in" : "Create your account";
}

function authError(message) {
    if (!authMsg) return;
    authMsg.textContent = message;
    authMsg.hidden = false;
    authMsg.classList.add("error");
}

/* Re-check the token on a timer: a 30-minute token must not keep working after
   it expires, and the workspace panels must fall back to the 401 state. */
setInterval(async () => {
    if (!SESSION) return;
    const me = await Auth.me(SESSION.token);
    if (!me.ok) {
        SESSION = null;
        persistSession();
        renderAuthState();
        renderWorkspace();
        syncCheckoutAuth();
        toast("Session expired — please sign in again");
    }
}, 60 * 1000);

/* ---- after a successful login/register ---- */
function applySession(session) {
    SESSION = session;
    persistSession();
    renderAuthState();
    renderWorkspace();
    syncCheckoutAuth();
}

/* The nav bar is the first place the role becomes visible. */
function renderAuthState() {
    const loginBtn = document.getElementById("loginBtn");
    const box = document.getElementById("accountBox");

    if (!SESSION) {
        loginBtn.hidden = false;
        box.hidden = true;
        document.getElementById("accountMenu").hidden = true;
        return;
    }

    const u = SESSION.user;
    loginBtn.hidden = true;
    box.hidden = false;
    document.getElementById("accountAvatar").textContent = ROLE_ICON(u.role);
    document.getElementById("accountName").textContent = u.name.split(" ")[0];
    document.getElementById("accountRole").textContent = ROLE_LABEL(u.role);
    document.getElementById("menuName").textContent = u.name;
    document.getElementById("menuEmail").textContent = u.email;
}

/* ---- login / register / logout ---- */
loginForm.addEventListener("submit", async e => {
    e.preventDefault();
    const res = await Auth.login({
        email: document.getElementById("loginEmail").value,
        password: document.getElementById("loginPassword").value
    });
    if (!res.ok) return authError(res.error);
    applySession({ token: res.token, user: res.user, session_id: Auth.currentSession()?.session_id });
    loginForm.reset();
    closeAuth();
    toast(`Welcome back, ${res.user.name.split(" ")[0]} — ${ROLE_LABEL(res.user.role)}`);
});

registerForm.addEventListener("submit", async e => {
    e.preventDefault();
    const res = await Auth.register({
        name: document.getElementById("regName").value,
        email: document.getElementById("regEmail").value,
        password: document.getElementById("regPassword").value
    });
    if (!res.ok) return authError(res.error);
    applySession({ token: res.token, user: res.user, session_id: Auth.currentSession()?.session_id });
    registerForm.reset();
    updatePwRules("");
    closeAuth();
    toast(`Account created — signed in as ${ROLE_LABEL(res.user.role)}`);
});

function logout() {
    if (SESSION) Auth.logout(SESSION.session_id || null, SESSION.user.user_id);
    SESSION = null;
    persistSession();
    renderAuthState();
    renderWorkspace();
    syncCheckoutAuth();
    toast("Signed out");
}

/* Live password-policy feedback in the register form. */
function updatePwRules(password) {
    const checks = {
        length: password.length >= 8,
        upper: /[A-Z]/.test(password),
        lower: /[a-z]/.test(password),
        digit: /\d/.test(password)
    };
    document.querySelectorAll("#pwRules li").forEach(li =>
        li.classList.toggle("ok", !!checks[li.dataset.rule]));
}

/* ---- ROLE WORKSPACE: three different interfaces for three roles ---- */
function wsOrderRows(orders, actions) {
    if (!orders.length) return `<p class="ws-empty">No orders yet.</p>`;
    return `<div class="ws-table">` + orders.map(o => `
        <div class="ws-row">
            <div>
                <strong>${o.order_id}</strong>
                <span class="ws-sub">${o.address}</span>
            </div>
            <span class="ws-amount">$${o.total.toFixed(2)}</span>
            <span class="status-pill" data-status="${o.order_status}">${o.order_status}</span>
            ${actions ? actions(o) : ""}
        </div>`).join("") + `</div>`;
}

/* Which tabs each role sees. Tabs are built from the SAME permission matrix
   the API guard uses, so the interface can never offer a forbidden action. */
function workspaceTabs(role) {
    const tabs = [];
    if (Auth.can(role, "orders:read:own")) tabs.push({ id: "my-orders", label: "My orders" });
    if (Auth.can(role, "orders:read:all")) tabs.push({ id: "all-orders", label: "All orders" });
    if (Auth.can(role, "orders:update:status")) tabs.push({ id: "fulfil", label: "Fulfilment" });
    if (Auth.can(role, "users:read")) tabs.push({ id: "users", label: "Users & roles" });
    if (Auth.can(role, "audit:read")) tabs.push({ id: "audit", label: "Audit log" });
    tabs.push({ id: "security", label: "My security" });
    return tabs;
}

let activeWsTab = null;

function renderWorkspace() {
    const locked = document.getElementById("wsLocked");
    const signed = document.getElementById("wsSignedIn");

    if (!SESSION) {
        locked.hidden = false;
        signed.hidden = true;
        return;
    }
    locked.hidden = true;
    signed.hidden = false;

    const u = SESSION.user;
    document.getElementById("wsAvatar").textContent = ROLE_ICON(u.role);
    document.getElementById("wsTitle").textContent = `${ROLE_LABEL(u.role)} workspace`;
    document.getElementById("wsBlurb").textContent = Auth.ROLE_INFO[u.role].blurb;
    document.getElementById("wsRole").textContent = `role: ${u.role}`;
    document.getElementById("wsSession").textContent = `session ${SESSION.session_id || "—"}`;

    const tabs = workspaceTabs(u.role);
    if (!tabs.some(t => t.id === activeWsTab)) activeWsTab = tabs[0].id;

    document.getElementById("wsTabs").innerHTML = tabs.map(t =>
        `<button class="ws-tab${t.id === activeWsTab ? " active" : ""}" data-ws-tab="${t.id}">${t.label}</button>`
    ).join("");

    renderWsPanel(activeWsTab);
    renderMatrix();
}

function renderWsPanel(tab) {
    const panel = document.getElementById("wsPanel");
    const u = SESSION.user;
    const myOrders = getOrdersByCustomer(u.customer_id);

    if (tab === "my-orders") {
        panel.innerHTML = `
            <h4>My orders <span class="ws-count">${myOrders.length}</span></h4>
            <p class="ws-note">SELECT * FROM orders WHERE customer_id = ${u.customer_id ?? "—"}</p>
            ${wsOrderRows(myOrders, o => `<button class="ws-link" data-track="${o.order_id}">Track</button>`)}`;
        return;
    }

    if (tab === "all-orders") {
        panel.innerHTML = `
            <h4>All orders <span class="ws-count">${ORDERS.length}</span></h4>
            <p class="ws-note">SELECT o.*, c.name FROM orders o JOIN customers c ON c.customer_id = o.customer_id</p>
            ${wsOrderRows(ORDERS, o => `<button class="ws-link" data-track="${o.order_id}">Track</button>`)}`;
        return;
    }

    if (tab === "fulfil") {
        panel.innerHTML = `
            <h4>Fulfilment queue</h4>
            <p class="ws-note">Advance a parcel along the delivery lifecycle. Each change writes a
                tracking event and is guarded by <code>orders:update:status</code>.</p>
            ${wsOrderRows(ORDERS, o => `
                <select class="ws-select" data-status-for="${o.order_id}">
                    ${LIFECYCLE.map(s => `<option${s === o.order_status ? " selected" : ""}>${s}</option>`).join("")}
                </select>
                <button class="ws-link" data-save-status="${o.order_id}">Save</button>`)}`;
        return;
    }

    if (tab === "users") {
        panel.innerHTML = `
            <h4>Users &amp; roles <span class="ws-count">${Auth.USERS.length}</span></h4>
            <p class="ws-note">Only an administrator may read this table. Changing a role rewrites
                USERS.role_id — and the change is visible immediately because the role is re-read
                from the database on every request.</p>
            <div class="ws-table">
                ${Auth.USERS.map(x => `
                    <div class="ws-row">
                        <div>
                            <strong>${x.name}</strong>
                            <span class="ws-sub">${x.email}</span>
                        </div>
                        <span class="hash-cell" title="password_hash">${x.password_hash.slice(0, 22)}…</span>
                        <select class="ws-select" data-role-for="${x.user_id}">
                            ${Auth.ROLES.map(r => `<option value="${r.role_id}"${r.role_id === x.role_id ? " selected" : ""}>${r.role_name}</option>`).join("")}
                        </select>
                        <button class="ws-link" data-save-role="${x.user_id}">Save</button>
                    </div>`).join("")}
            </div>`;
        return;
    }

    if (tab === "audit") {
        panel.innerHTML = `
            <h4>Audit log <span class="ws-count">${Auth.AUDIT_LOG.length}</span></h4>
            <p class="ws-note">Every login, logout, denied request and role change is recorded.</p>
            <div class="ws-table">
                ${Auth.AUDIT_LOG.map(l => `
                    <div class="ws-row">
                        <div><strong>${l.action}</strong><span class="ws-sub">${l.target}</span></div>
                        <span class="ws-sub">user #${l.user_id ?? "guest"}</span>
                        <span class="ws-sub">${l.at}</span>
                    </div>`).join("")}
            </div>`;
        return;
    }

    /* security tab — shown to every role */
    panel.innerHTML = `
        <h4>My security</h4>
        <div class="sec-grid">
            <div class="sec-card">
                <span class="sec-label">Password storage</span>
                <code>${(Auth.USERS.find(x => x.user_id === u.user_id)?.password_hash || "").slice(0, 40)}…</code>
                <p>PBKDF2-SHA256 · 120 000 iterations · unique random salt per user.</p>
            </div>
            <div class="sec-card">
                <span class="sec-label">Session token (JWT, HS256)</span>
                <code class="token-cell">${SESSION.token}</code>
                <p>Signed payload: <code>sub</code>, <code>role</code>, <code>jti</code>, <code>exp</code>.
                    Try editing it in localStorage — the signature check fails and you are logged out.</p>
            </div>
            <div class="sec-card">
                <span class="sec-label">Permissions of my role</span>
                <ul class="perm-list">
                    ${Object.keys(Auth.PERMISSIONS)
            .filter(p => Auth.PERMISSIONS[p].includes(u.role))
            .map(p => `<li class="ok">✓ ${p}</li>`).join("")}
                    ${Object.keys(Auth.PERMISSIONS)
            .filter(p => !Auth.PERMISSIONS[p].includes(u.role))
            .map(p => `<li class="no">✕ ${p}</li>`).join("")}
                </ul>
            </div>
        </div>`;
}

/* The visible RBAC matrix, with the signed-in user's role highlighted. */
function renderMatrix() {
    const tbody = document.querySelector("#matrixTable tbody");
    if (!tbody || !SESSION) return;
    const mine = SESSION.user.role;
    tbody.innerHTML = Object.entries(Auth.PERMISSIONS).map(([perm, roles]) => `
        <tr>
            <td><code>${perm}</code></td>
            ${["user", "manager", "admin"].map(r => `
                <td class="${roles.includes(r) ? "yes" : "no"}${r === mine ? " mine" : ""}">
                    ${roles.includes(r) ? "✓" : "—"}
                </td>`).join("")}
        </tr>`).join("");
}

/* ---- workspace events (delegated) ---- */
document.getElementById("wsTabs").addEventListener("click", e => {
    const btn = e.target.closest("[data-ws-tab]");
    if (!btn) return;
    activeWsTab = btn.dataset.wsTab;
    renderWorkspace();
});

document.getElementById("wsPanel").addEventListener("click", async e => {
    const trackBtn = e.target.closest("[data-track]");
    if (trackBtn) {
        document.getElementById("orderInput").value = trackBtn.dataset.track;
        document.getElementById("track").scrollIntoView({ behavior: "smooth" });
        trackOrder();
        return;
    }

    /* Protected: orders:update:status */
    const saveStatus = e.target.closest("[data-save-status]");
    if (saveStatus) {
        const id = saveStatus.dataset.saveStatus;
        const guard = await Auth.requireAuth("orders:update:status")(SESSION?.token);
        if (!guard.ok) return toast(`403 · ${guard.error}`);
        const select = document.querySelector(`[data-status-for="${id}"]`);
        updateOrderStatus(id, select.value, `Status set to "${select.value}" by ${guard.user.name}.`);
        toast(`${id} → ${select.value}`);
        renderWorkspace();
        return;
    }

    /* Protected: users:update:role */
    const saveRole = e.target.closest("[data-save-role]");
    if (saveRole) {
        const userId = Number(saveRole.dataset.saveRole);
        const guard = await Auth.requireAuth("users:update:role")(SESSION?.token);
        if (!guard.ok) return toast(`403 · ${guard.error}`);
        const select = document.querySelector(`[data-role-for="${userId}"]`);
        const target = Auth.findUserById(userId);
        const before = Auth.roleNameOf(target);
        target.role_id = Number(select.value);
        Auth.AUDIT_LOG.unshift({
            log_id: 0, user_id: guard.user.user_id, action: "users:update:role",
            target: `${target.email}: ${before} → ${Auth.roleNameOf(target)}`,
            at: new Date().toLocaleString("en-GB", { hour12: false })
        });
        toast(`${target.email} is now ${Auth.roleNameOf(target)}`);

        /* If the admin demoted themselves, refresh their own token. */
        if (target.user_id === SESSION.user.user_id) {
            const me = await Auth.me(SESSION.token);
            if (me.ok) applySession({ token: SESSION.token, user: me.user });
        }
        renderWorkspace();
    }
});

/* ---- auth-related wiring ---- */
document.getElementById("loginBtn").addEventListener("click", () => openAuth("login"));
document.getElementById("closeAuth").addEventListener("click", closeAuth);
authOverlay.addEventListener("click", e => { if (e.target === authOverlay) closeAuth(); });
document.querySelectorAll("[data-auth-tab]").forEach(btn =>
    btn.addEventListener("click", () => switchAuthTab(btn.dataset.authTab)));

document.getElementById("regPassword").addEventListener("input", e => updatePwRules(e.target.value));

document.querySelectorAll(".demo-account").forEach(btn => btn.addEventListener("click", async () => {
    /* Fast path: sign in directly, with no password hashing involved. This is
       what makes "click a role and you're in" reliable on every browser. */
    try {
        const res = await Auth.loginAsRole(btn.dataset.role);
        if (!res.ok) {
            authError(res.error || "Could not sign in.");
            toast("Sign-in failed — see the message above");
            return;
        }
        applySession({ token: res.token, user: res.user, session_id: res.session_id });
        authMsg.hidden = true;
        closeAuth();
        toast(`Signed in as ${res.user.name} — ${ROLE_LABEL(res.user.role)}`);
    } catch (err) {
        console.error("demo sign-in failed", err);
        authError("Sign-in failed: " + err.message);
    }
}));

document.getElementById("accountBtn").addEventListener("click", e => {
    /* The document-level "click outside" handler below closes the menu; without
       stopping propagation here the menu would reopen and immediately close. */
    e.stopPropagation();
    const menu = document.getElementById("accountMenu");
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    e.currentTarget.setAttribute("aria-expanded", String(willOpen));
});
document.addEventListener("click", e => {
    /* Only close when the click really landed outside the account widget. */
    if (e.target.closest(".account")) return;
    const menu = document.getElementById("accountMenu");
    if (menu && !menu.hidden) {
        menu.hidden = true;
        document.getElementById("accountBtn").setAttribute("aria-expanded", "false");
    }
});
document.getElementById("logoutBtn").addEventListener("click", logout);

document.getElementById("wsLoginBtn").addEventListener("click", () => openAuth("login"));
document.getElementById("wsRegisterBtn").addEventListener("click", () => openAuth("register"));
document.getElementById("gateLoginBtn").addEventListener("click", () => openAuth("login"));
document.getElementById("gateRegisterBtn").addEventListener("click", () => openAuth("register"));

/* --------------------------------------------------------------------------
   DEMO PLAYGROUND
   --------------------------------------------------------------------------
   Defined BEFORE initAuth() so it exists the moment the page loads. Everything
   here goes through Auth.loginAsRole(), which needs no password hashing — so
   these helpers work immediately, even while seeding is still running.
   -------------------------------------------------------------------------- */
const DEMO_PASSWORDS = { user: "User1234", manager: "Manager1234", admin: "Admin1234" };

/* Resolves once the demo accounts have their password hashes. Only the typed
   password form depends on this; the role buttons never do. */
const ready = Auth.seeded;

window.DEMO = {
    /* Sign in as a role on the console, then call a permission-guarded endpoint:
           await DEMO.api('user',  'users:read')   -> 403 Forbidden
           await DEMO.api('admin', 'users:read')   -> 200 OK            */
    api: async (role, permission) => {
        const login = await Auth.loginAsRole(role);
        if (!login.ok) return login;

        const result = await Auth.requireAuth(permission)(login.token);
        console.table([{ call: `${role} -> ${permission}`, status: result.status, allowed: result.ok }]);
        return result;
    },

    /* Sign in as a role from the console (also what the modal buttons use):
           await DEMO.login('manager')                                        */
    login: async role => {
        const res = await Auth.loginAsRole(role);
        if (res.ok) applySession({ token: res.token, user: res.user, session_id: res.session_id });
        return res;
    },

    /* All seeded accounts, so you can see the email/password pair for each role. */
    accounts: () => Auth.USERS.map(u => ({
        email: u.email,
        role: Auth.roleNameOf(u),
        password: DEMO_PASSWORDS[Auth.roleNameOf(u)],
        password_hash_ready: !!u.password_hash
    })),

    logout: () => logout(),
    session: () => SESSION,
    users: () => Auth.USERS.map(Auth.publicUser),
    audit: () => Auth.AUDIT_LOG
};

/* --------------------------------------------------------------------------
   DIAGNOSTICS
   --------------------------------------------------------------------------
   If sign-in ever "does nothing", run `checkAuth()` in the browser console. It
   reports exactly which prerequisite is missing (secure context / seed accounts /
   crypto.subtle) instead of failing silently.
   -------------------------------------------------------------------------- */
function checkAuth() {
    const report = {
        page: location.href,
        secureContext: window.isSecureContext,
        hasWebCrypto: typeof crypto !== "undefined" && !!crypto.subtle,
        hasAuthObject: typeof Auth !== "undefined",
        seededAccounts: typeof Auth !== "undefined" ? Auth.USERS.length : 0,
        seededEmails: typeof Auth !== "undefined" ? Auth.USERS.map(u => u.email) : [],
        loggedIn: SESSION ? SESSION.user.email : null,
        canLogin: null
    };
    if (!report.hasWebCrypto) {
        report.problem = "crypto.subtle is missing — Web Crypto needs https://, localhost or file://";
    } else if (report.seededAccounts === 0) {
        report.problem = "no accounts seeded — seeding failed or is still running; reload the page";
    } else {
        report.canLogin = "accounts are seeded — the demo buttons should work";
    }
    console.table(report);
    return report;
}
window.checkAuth = checkAuth;

/* --------------------------------------------------------------------------
   INIT
   -------------------------------------------------------------------------- */
seedDemoOrders();
renderChips();
renderProducts();
renderCart();
showTrackingPlaceholder("Enter an order number above to see its delivery progress.");
document.getElementById("year").textContent = new Date().getFullYear();

/* --- Week 5: restore the session, then paint the role-aware interface --- */
(async function initAuth() {
    /* The three demo accounts already exist by the time this runs (auth.js
       creates them synchronously). seedUsers() only fills in their password
       hashes, in the background — so a role button clicked immediately still
       works, it just does not need a hash. */
    seedUsers().catch(err => console.error("GAmazon auth: seeding failed", err));

    const stored = loadStoredSession();
    if (stored?.token) {
        const me = await Auth.me(stored.token);   /* token is verified, not trusted */
        if (me.ok) SESSION = { token: stored.token, user: me.user };
        else persistSession();                    /* expired / tampered -> drop it */
    }

    renderAuthState();
    renderWorkspace();
    syncCheckoutAuth();

    console.info("%cGAmazon Auth & RBAC ready", "color:#2456d8;font-weight:700",
        "\nDemo accounts: user@ / manager@ / admin@gamazon.dev (User1234 / Manager1234 / Admin1234)" +
        "\nTry:  await DEMO.api('user','users:read')   -> 403" +
        "\n      await DEMO.api('admin','users:read')  -> 200" +
        "\n      await DEMO.login('manager')  |  DEMO.users()  |  DEMO.audit()");
})();