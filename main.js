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

function renderMeta({ order, customer, items = [] }) {
    const itemText = items.map(i => `${i.quantity}× ${i.name}`).join(", ");
    const total = Number(order.total);
    metaEl.innerHTML = `
        <div class="meta-row"><span>Order</span><span>${escapeHtml(order.order_id)}</span></div>
        <div class="meta-row"><span>Placed by</span><span>${escapeHtml(customer ? customer.name : "Guest")}</span></div>
        <div class="meta-row"><span>Items</span><span>${escapeHtml(itemText)}</span></div>
        <div class="meta-row"><span>Deliver to</span><span>${escapeHtml(order.address)}</span></div>
        <div class="meta-row"><span>Total</span><span>${Number.isFinite(total) ? `$${total.toFixed(2)}` : "Not priced"}</span></div>
        <div class="meta-row"><span>Status</span><span>${escapeHtml(order.order_status)}</span></div>
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
                <div class="tl-title">${escapeHtml(ev.title)}</div>
                <div class="tl-time">${escapeHtml(ev.time)}</div>
                <div class="tl-desc">${escapeHtml(ev.desc)}</div>
            </div>
        `);
    });

    // Terminal statuses must not be followed by fictional pending lifecycle stages.
    const lastTitle = String(events[events.length - 1]?.title || "").trim().toLowerCase();
    const isTerminal = ["delivered", "cancelled", "canceled"].includes(lastTitle);
    if (!isTerminal) {
        const remaining = Math.max(0, LIFECYCLE.length - reached);
        for (let i = 0; i < remaining; i++) {
            timelineEl.insertAdjacentHTML("beforeend", `
                <div class="tl-item pending">
                    <div class="tl-title">${escapeHtml(LIFECYCLE[reached + i])}</div>
                    <div class="tl-time">pending</div>
                    <div class="tl-desc">We'll update you as soon as this stage is reached.</div>
                </div>
            `);
        }
    }
}

function showTrackingPlaceholder(message) {
    timelineEl.classList.add("has-empty");
    timelineEl.innerHTML = `<div class="tl-empty">${message}</div>`;
}

async function renderParcelFiles(trackingNumber) {
    const panel = document.getElementById("parcelFilesPanel");
    if (!panel || !SESSION?.token) { if (panel) panel.hidden = true; return; }
    panel.hidden = false;
    panel.dataset.trackingNumber = trackingNumber;
    panel.innerHTML = '<h3>Parcel documents</h3><p class="ws-empty">Loading files…</p>';
    try {
        const response = await fetch(`${Auth.API_BASE}/api/files/parcel/${encodeURIComponent(trackingNumber)}`, {
            headers: { Authorization: `Bearer ${SESSION.token}` }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
        const files = data.files || [];
        panel.innerHTML = `
          <div class="parcel-files-head"><div><h3>Parcel documents</h3><p>Upload and download documents attached to this parcel.</p></div></div>
          <form id="parcelUploadForm" class="parcel-upload-form">
            <input id="parcelFileInput" type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" required>
            <button class="btn btn-primary" type="submit">Upload file</button>
            <small>PDF, JPG, PNG or WEBP · Maximum 5 MB</small>
          </form>
          <div class="parcel-file-list">${files.map(file => `<div class="parcel-file-row"><div><strong>${escapeHtml(file.original_name)}</strong><small>${escapeHtml(file.mime_type)} · ${(Number(file.size_bytes)/1024).toFixed(1)} KB · ${new Date(file.created_at).toLocaleString()}</small></div><button type="button" class="ws-link" data-download-file="${Number(file.file_id)}">Download</button></div>`).join("") || '<p class="ws-empty">No documents uploaded for this parcel.</p>'}</div>
          <p class="parcel-file-feedback" id="parcelFileFeedback" role="status"></p>`;
        document.getElementById("parcelUploadForm").addEventListener("submit", async event => {
            event.preventDefault();
            const input = document.getElementById("parcelFileInput");
            const feedback = document.getElementById("parcelFileFeedback");
            const file = input.files?.[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) { feedback.textContent = "File exceeds the 5 MB limit."; return; }
            const formData = new FormData(); formData.append("file", file);
            const upload = await fetch(`${Auth.API_BASE}/api/files/parcel/${encodeURIComponent(trackingNumber)}`, {
                method: "POST", headers: { Authorization: `Bearer ${SESSION.token}` }, body: formData
            });
            const result = await upload.json().catch(() => ({}));
            if (!upload.ok) { feedback.textContent = result.message || `Upload failed (${upload.status})`; return; }
            toast("File uploaded successfully");
            await renderParcelFiles(trackingNumber);
        });
        panel.querySelectorAll("[data-download-file]").forEach(button => button.addEventListener("click", async () => {
            button.disabled = true; button.textContent = "Downloading…";
            try {
                const download = await fetch(`${Auth.API_BASE}/api/files/${button.dataset.downloadFile}/download`, { headers: { Authorization: `Bearer ${SESSION.token}` } });
                if (!download.ok) { const result = await download.json().catch(() => ({})); throw new Error(result.message || `HTTP ${download.status}`); }
                const blob = await download.blob();
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a"); link.href = url;
                const row = button.closest(".parcel-file-row");
                link.download = row.querySelector("strong").textContent;
                document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
            } catch (error) { toast(`Download failed: ${error.message}`); }
            finally { button.disabled = false; button.textContent = "Download"; }
        }));
    } catch (error) {
        panel.innerHTML = `<h3>Parcel documents</h3><p class="ws-empty">${escapeHtml(error.message)}</p>`;
    }
}

async function trackOrder() {
    const id = orderInput.value.trim();
    if (!id) {
        toast("Please enter an order or tracking number");
        return;
    }

    // Prefer the real API so a local demo order can never shadow a database
    // parcel with a matching input. Local demo orders are only a fallback for
    // their explicit GA-* order IDs when the API reports not found.
    try {
        const data = await trackDelivery(id);
        const parcel = data.parcel || {};
        const order = data.order || {};
        const history = Array.isArray(data.history) ? data.history : [];
        // A status event may have no depot_id. Keep showing the last known
        // location from an earlier event that did record a depot.
        const lastKnownLocation = [...history].reverse().find(item => item.city || item.depot_name);
        const currentCity = data.current_city || lastKnownLocation?.city || lastKnownLocation?.depot_name || null;
        const latestHistoryEvent = history[history.length - 1];
        const currentStatus = latestHistoryEvent?.status || data.current_status || order.status || "—";
        const lastUpdate = latestHistoryEvent?.timestamp || data.last_update;
        metaEl.innerHTML = `
            <div class="meta-row"><span>Tracking number</span><span>${escapeHtml(data.tracking_number || id)}</span></div>
            <div class="meta-row"><span>Order</span><span>#${escapeHtml(order.order_id ?? "—")}</span></div>
            <div class="meta-row"><span>Parcel weight</span><span>${escapeHtml(parcel.weight_kg ?? "—")} kg</span></div>
            <div class="meta-row"><span>Service</span><span>${escapeHtml(parcel.parcel_type ?? "—")}</span></div>
            <div class="meta-row"><span>Current status</span><span>${escapeHtml(currentStatus)}</span></div>
            <div class="meta-row"><span>Current city</span><span>${escapeHtml(currentCity || "Not recorded")}</span></div>
            <div class="meta-row"><span>Last update</span><span>${lastUpdate ? escapeHtml(new Date(lastUpdate).toLocaleString()) : "—"}</span></div>
        `;
        const events = history.map(item => ({
            title: item.status,
            time: item.timestamp ? new Date(item.timestamp).toLocaleString() : "—",
            desc: [item.depot_name, item.city].filter(Boolean).join(" · ") || "Status recorded in the logistics system."
        }));
        if (!events.length && data.current_status) {
            events.push({ title:data.current_status, time:"Latest status", desc:data.current_city || "Status recorded in the logistics system." });
        }
        renderTimeline(events);
        await renderParcelFiles(data.tracking_number || id);
    } catch (error) {
        const localResult = /^GA-/i.test(id) ? getOrder(id) : null;
        if (localResult && /not found|404/i.test(error.message || "")) {
            renderMeta(localResult);
            renderTimeline(localResult.events);
            document.getElementById("parcelFilesPanel").hidden = true;
            return;
        }
        metaEl.innerHTML = "";
        document.getElementById("parcelFilesPanel").hidden = true;
        showTrackingPlaceholder(`We couldn't find parcel <strong>${escapeHtml(id)}</strong>. ${escapeHtml(error.message || "Check the tracking number and try again.")}`);
    }
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

/* The auth modal lives in index.html, which loads this file after auth.js. The
   whole block below is skipped when those elements are absent (e.g. if main.js
   is reused on a page without the modal), instead of throwing on load. */
const HAS_AUTH_UI = !!(authOverlay && loginForm && registerForm);

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
if (HAS_AUTH_UI) loginForm.addEventListener("submit", async e => {
    e.preventDefault();
    const res = await Auth.login({
        email: document.getElementById("loginEmail").value,
        password: document.getElementById("loginPassword").value
    });
    if (!res.ok) return authError(res.error);
    applySession({ token: res.token, user: res.user, session_id: res.session_id });
    loginForm.reset();
    closeAuth();
    toast(`Welcome back, ${res.user.name.split(" ")[0]} — ${ROLE_LABEL(res.user.role)}`);
});

if (HAS_AUTH_UI) registerForm.addEventListener("submit", async e => {
    e.preventDefault();
    const res = await Auth.register({
        name: document.getElementById("regName").value,
        phone: document.getElementById("regPhone").value,
        email: document.getElementById("regEmail").value,
        password: document.getElementById("regPassword").value
    });
    if (!res.ok) return authError(res.error);
    applySession({ token: res.token, user: res.user, session_id: res.session_id });
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
    if (Auth.can(role, "routes:manage")) {
        tabs.push({ id: "routes", label: "Route Management" });
        tabs.push({ id: "couriers", label: "Courier Management" });
    }
    if (role === "courier") tabs.push({ id: "my-deliveries", label: "My deliveries" });
    if (Auth.can(role, "users:read")) {
        tabs.push({ id: "analytics", label: "Analytics" });
        tabs.push({ id: "users", label: "Users & roles" });
    }
    if (Auth.can(role, "audit:read")) tabs.push({ id: "audit", label: "Audit log" });
    tabs.push({ id: "security", label: "My security" });
    return tabs;
}

let activeWsTab = null;
let workspaceRequestId = 0;

const ordersState = {
    page: 1,
    limit: 5,
    sort: "order_date",
    order: "desc",
    status: "",
    search: ""
};

async function fetchOrders() {
    const params = new URLSearchParams({
        page: ordersState.page,
        limit: ordersState.limit,
        sort: ordersState.sort,
        order: ordersState.order
    });

    if (ordersState.status) {
        params.set("status", ordersState.status);
    }

    if (ordersState.search) {
        params.set("search", ordersState.search);
    }

    const response = await fetch(
        `${Auth.API_BASE}/api/orders?${params}`,
        {
            headers: {
                Authorization: `Bearer ${SESSION.token}`
            }
        }
    );

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[c]);
}

async function renderDatabaseOrders(tab) {
    const panel = document.getElementById("wsPanel");
    const token = SESSION?.token;

    panel.innerHTML = "<p>Loading orders...</p>";

    try {
        const data = await fetchOrders();

        // Prevent outdated responses after switching tabs/logout
        if (SESSION?.token !== token || activeWsTab !== tab) {
            return;
        }

        panel.innerHTML = `
            <h4>${tab === "my-orders" ? "My orders" : "All orders"}
                <span class="ws-count">${data.total}</span>
            </h4>

            <div class="ws-filters">
                <select id="ordersStatus">
                    <option value="">All statuses</option>
                    <option value="Created">Created</option>
                    <option value="In Transit">In Transit</option>
                    <option value="Delivered">Delivered</option>
                    <option value="Cancelled">Cancelled</option>
                </select>

                <select id="ordersSort">
                    <option value="order_date">Date</option>
                    <option value="total_cost">Price</option>
                    <option value="order_id">Order ID</option>
                </select>

                <select id="ordersDirection">
                    <option value="desc">Descending</option>
                    <option value="asc">Ascending</option>
                </select>

                <input id="ordersSearch"
                    placeholder="Order ID or tracking number">

                <button id="ordersSearchBtn" class="ws-link">
                    Search
                </button>
            </div>

            <div class="ws-table">
                ${data.orders.map(o => `
                    <div class="ws-row">
                        <div>
                            <strong>Order #${o.order_id}</strong>
                            <span class="ws-sub">
                                ${new Date(o.order_date).toLocaleDateString()}
                            </span>
                        </div>

                        <span class="ws-amount">
                            ${o.total_cost == null ? "Not priced" : `${Number(o.total_cost).toFixed(2)} ₸`}
                        </span>

                        <span class="status-pill"
                            data-status="${escapeHtml(o.status)}">
                            ${escapeHtml(o.status)}
                        </span>
                    </div>
                `).join("") || '<p class="ws-empty">No orders found.</p>'}
            </div>

            <div class="ws-pagination">
                <button id="ordersPrev" class="ws-link"
                    ${data.page <= 1 ? "disabled" : ""}>
                    Previous
                </button>

                <span>Page ${data.page} of ${data.totalPages || 1}</span>

                <button id="ordersNext" class="ws-link"
                    ${data.page >= data.totalPages ? "disabled" : ""}>
                    Next
                </button>
            </div>
        `;

        document.getElementById("ordersStatus").value = ordersState.status;
        document.getElementById("ordersSort").value = ordersState.sort;
        document.getElementById("ordersDirection").value = ordersState.order;
        document.getElementById("ordersSearch").value = ordersState.search;

        function reload() {
            ordersState.page = 1;
            renderDatabaseOrders(tab);
        }

        document.getElementById("ordersStatus").onchange = e => {
            ordersState.status = e.target.value;
            reload();
        };

        document.getElementById("ordersSort").onchange = e => {
            ordersState.sort = e.target.value;
            reload();
        };

        document.getElementById("ordersDirection").onchange = e => {
            ordersState.order = e.target.value;
            reload();
        };

        document.getElementById("ordersSearchBtn").onclick = () => {
            ordersState.search =
                document.getElementById("ordersSearch").value.trim();
            reload();
        };

        document.getElementById("ordersSearch").onkeydown = e => {
            if (e.key === "Enter") {
                document.getElementById("ordersSearchBtn").click();
            }
        };

        document.getElementById("ordersPrev").onclick = () => {
            ordersState.page--;
            renderDatabaseOrders(tab);
        };

        document.getElementById("ordersNext").onclick = () => {
            ordersState.page++;
            renderDatabaseOrders(tab);
        };

    } catch (error) {
        if (SESSION?.token === token && activeWsTab === tab) {
            panel.textContent = "Failed to load orders: " + error.message;
        }
        console.error(error);
    }
}

async function renderFulfilmentQueue() {
    const panel = document.getElementById("wsPanel");
    const token = SESSION?.token;
    panel.innerHTML = `<h4>Fulfilment queue</h4><p>Loading parcels...</p>`;
    try {
        const response = await fetch(`${Auth.API_BASE}/api/orders?page=1&limit=100&sort=order_date&order=desc`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
        if (SESSION?.token !== token || activeWsTab !== "fulfil") return;

        const orders = data.orders || [];
        panel.innerHTML = `
            <h4>Fulfilment queue <span class="ws-count">${data.total ?? orders.length}</span></h4>
            <p class="ws-note">Manage real parcels from the logistics database. Status changes are saved
                to PostgreSQL and appear in the customer's tracking history.</p>
            <div class="ws-fulfil-list">
                ${orders.map(o => {
                    const status = String(o.status || "Created").trim();
                    const terminal = ["Delivered", "Cancelled"].includes(status);
                    const amount = Number(o.total_cost);
                    return `
                    <div class="ws-row ws-fulfil-row">
                        <div>
                            <strong>Order #${escapeHtml(o.order_id)}</strong>
                            <span class="ws-sub">${escapeHtml(o.tracking_number || "No tracking number")}</span>
                            <span class="ws-sub">${o.order_date ? new Date(o.order_date).toLocaleString() : ""}</span>
                        </div>
                        <span class="ws-amount">${Number.isFinite(amount) && amount > 0 ? `${amount.toFixed(2)} ₸` : "Not priced"}</span>
                        <span class="status-pill" data-status="${escapeHtml(status)}">${escapeHtml(status)}</span>
                        ${o.tracking_number ? `
                            <select class="ws-select" data-status-for="${escapeHtml(o.tracking_number)}" ${terminal ? "disabled" : ""}>
                                ${["Created", "In Transit", "At Depot", "Out for delivery", "Delivered", "Cancelled"].map(s =>
                                    `<option value="${s}"${s === status ? " selected" : ""}>${s}</option>`
                                ).join("")}
                            </select>
                            <button class="ws-link" data-save-status="${escapeHtml(o.tracking_number)}" ${terminal ? 'disabled title="Terminal status cannot be changed"' : ""}>Save</button>
                            <button class="ws-link" data-track="${escapeHtml(o.tracking_number)}">Track</button>
                        ` : `<span class="ws-sub">No parcel tracking record</span>`}
                    </div>`;
                }).join("") || '<p class="ws-empty">No database orders found.</p>'}
            </div>`;
    } catch (error) {
        if (SESSION?.token === token && activeWsTab === "fulfil") {
            panel.innerHTML = `<h4>Fulfilment queue</h4><p class="ws-empty">Failed to load parcels: ${escapeHtml(error.message)}</p>`;
        }
        console.error("Fulfilment queue error:", error);
    }
}

function renderWorkspace() {
    const locked = document.getElementById("wsLocked");
    const signed = document.getElementById("wsSignedIn");
    const requestId = ++workspaceRequestId;

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

    renderMatrix();
    renderWsPanel(activeWsTab);
}

async function renderAdminAnalytics() {
    const panel = document.getElementById("wsPanel");
    const token = SESSION?.token;
    panel.innerHTML = '<h4>Analytics dashboard</h4><p>Loading analytics…</p>';
    try {
        const response = await fetch(`${Auth.API_BASE}/api/admin/dashboard`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
        if (SESSION?.token !== token || activeWsTab !== "analytics") return;
        const totals = data.totals || {};
        const maxDaily = Math.max(1, ...(data.orders_last_7_days || []).map(x => Number(x.count)));
        const maxStatus = Math.max(1, ...(data.orders_by_status || []).map(x => Number(x.count)));
        panel.innerHTML = `
          <div class="analytics-head"><div><h4>Analytics dashboard</h4><p class="ws-note">Generated ${escapeHtml(new Date(data.generated_at).toLocaleString())}</p></div>
            <button class="ws-link" id="exportOrdersCsv">Export orders CSV</button></div>
          <div class="analytics-kpis">
            <article class="analytics-kpi"><span>Total orders</span><strong>${Number(totals.total_orders || 0).toLocaleString()}</strong></article>
            <article class="analytics-kpi"><span>Customers</span><strong>${Number(totals.total_customers || 0).toLocaleString()}</strong></article>
            <article class="analytics-kpi"><span>Parcels</span><strong>${Number(totals.total_parcels || 0).toLocaleString()}</strong></article>
            <article class="analytics-kpi"><span>Delivered</span><strong>${Number(totals.delivered_parcels || 0).toLocaleString()}</strong></article>
            <article class="analytics-kpi"><span>Total order value</span><strong>${Number(totals.total_revenue || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} ₸</strong></article>
          </div>
          <div class="analytics-grid">
            <section class="analytics-card"><h5>Orders by status</h5>
              ${(data.orders_by_status || []).map(row => `<div class="analytics-bar-row"><span>${escapeHtml(row.status)}</span><div class="analytics-bar-track"><i style="width:${Math.min(100,Number(row.count)/maxStatus*100)}%"></i></div><b>${Number(row.count)}</b></div>`).join("") || '<p class="ws-empty">No orders yet.</p>'}
            </section>
            <section class="analytics-card"><h5>Orders — last 7 days</h5>
              ${(data.orders_last_7_days || []).map(row => `<div class="analytics-bar-row"><span>${new Date(row.date).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</span><div class="analytics-bar-track"><i style="width:${Math.min(100,Number(row.count)/maxDaily*100)}%"></i></div><b>${Number(row.count)}</b></div>`).join("")}
            </section>
          </div>
          <section class="analytics-card analytics-top"><h5>Top customers</h5><div class="ws-table">
            ${(data.top_customers || []).map(c => `<div class="ws-row"><div><strong>${escapeHtml(`${c.first_name} ${c.last_name}`)}</strong><span class="ws-sub">${escapeHtml(c.email)}</span></div><span>${Number(c.orders_count)} orders</span><b>${Number(c.total_spent || 0).toFixed(2)} ₸</b></div>`).join("") || '<p class="ws-empty">No customers found.</p>'}
          </div></section>`;
        document.getElementById("exportOrdersCsv").addEventListener("click", async () => {
            const exportResponse = await fetch(`${Auth.API_BASE}/api/admin/reports/orders.csv`, { headers: { Authorization: `Bearer ${token}` } });
            if (!exportResponse.ok) { toast(`Export failed: HTTP ${exportResponse.status}`); return; }
            const blob = await exportResponse.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a"); link.href = url; link.download = "gamazon-orders-report.csv";
            document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
        });
    } catch (error) {
        if (SESSION?.token === token && activeWsTab === "analytics") panel.innerHTML = `<h4>Analytics dashboard</h4><p class="ws-empty">${escapeHtml(error.message)}</p>`;
    }
}


function localDateTimeValue(date) {
    const pad = n => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function renderRouteManagement() {
    const panel = document.getElementById("wsPanel");
    const token = SESSION?.token;
    panel.innerHTML = '<h4>Route Management</h4><p class="ws-empty">Loading routes and available resources…</p>';
    try {
        const headers = { Authorization: `Bearer ${token}` };
        const [resourcesResponse, routesResponse] = await Promise.all([
            fetch(`${Auth.API_BASE}/api/routes/available-resources`, { headers }),
            fetch(`${Auth.API_BASE}/api/routes`, { headers })
        ]);
        const resourcesData = await resourcesResponse.json().catch(() => ({}));
        const routesData = await routesResponse.json().catch(() => ({}));
        if (!resourcesResponse.ok) throw new Error(resourcesData.message || `Resources HTTP ${resourcesResponse.status}`);
        if (!routesResponse.ok) throw new Error(routesData.message || `Routes HTTP ${routesResponse.status}`);
        if (SESSION?.token !== token || activeWsTab !== "routes") return;

        const drivers = resourcesData.drivers || [];
        const depots = resourcesData.depots || [];
        const routes = routesData.routes || [];
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
        tomorrow.setHours(9, 0, 0, 0);
        const driverOptions = drivers.map(d => `<option value="${Number(d.driver_id)}" data-vehicle="${Number(d.vehicle_id)}">${escapeHtml(`${d.first_name} ${d.last_name}`)} — ${escapeHtml(d.plate_number)} (${Number(d.capacity_kg)} kg)</option>`).join("");
        const depotOptionsFrom = depots.map((d, i) => `<option value="${Number(d.depot_id)}" ${i === 0 ? "selected" : ""}>${escapeHtml(`${d.city} — ${d.name}`)}</option>`).join("");
        const depotOptionsTo = depots.map((d, i) => `<option value="${Number(d.depot_id)}" ${i === 1 ? "selected" : ""}>${escapeHtml(`${d.city} — ${d.name}`)}</option>`).join("");
        const routeRows = routes.map(r => `
          <tr>
            <td>#${Number(r.route_id)}</td>
            <td>${escapeHtml(`${r.first_name} ${r.last_name}`)}<small>${escapeHtml(r.plate_number)} · ${Number(r.capacity_kg)} kg</small></td>
            <td>${escapeHtml(r.from_city || "—")} → ${escapeHtml(r.to_city || "—")}</td>
            <td>${escapeHtml(new Date(r.departure_time).toLocaleString())}</td>
            <td><span class="route-status" data-status="${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
            <td>${r.status === "Planned" ? `<button class="ws-link" type="button" data-cancel-route="${Number(r.route_id)}">Cancel</button>` : "—"}</td>
          </tr>`).join("");

        panel.innerHTML = `
          <div class="route-management-head"><div><h4>Route Management</h4><p class="ws-note">Create shared delivery routes. Customers can select routes that match their requests.</p></div><button type="button" class="ws-link" id="refreshRoutes">Refresh</button></div>
          <section class="route-form-card">
            <h5>Create route</h5>
            ${drivers.length && depots.length >= 2 ? `
              <form id="createRouteForm" class="route-form">
                <label>Available driver and vehicle
                  <select name="driver_id" id="routeDriver" required>${driverOptions}</select>
                </label>
                <label>Pickup depot<select name="from_depot_id" required>${depotOptionsFrom}</select></label>
                <label>Delivery depot<select name="to_depot_id" required>${depotOptionsTo}</select></label>
                <label>Departure date and time<input name="departure_time" type="datetime-local" min="${escapeHtml(localDateTimeValue(new Date()))}" value="${escapeHtml(localDateTimeValue(tomorrow))}" required></label>
                <label>Distance (km)<input name="distance_km" type="number" min="1" step="0.1" value="200" required></label>
                <div class="route-form-actions"><button class="btn btn-primary" type="submit">Create planned route</button><span id="routeFormFeedback" role="status"></span></div>
              </form>` : `<p class="ws-empty">${drivers.length ? "Create at least two depots before adding a route." : "No drivers with an available vehicle and no upcoming route are currently available."}</p>`}
          </section>
          <section class="route-list-card"><h5>Existing routes (${routes.length})</h5>
            ${routes.length ? `<div class="route-table-wrap"><table class="route-table"><thead><tr><th>ID</th><th>Driver / Vehicle</th><th>Direction</th><th>Departure</th><th>Status</th><th>Action</th></tr></thead><tbody>${routeRows}</tbody></table></div>` : '<p class="ws-empty">No routes found.</p>'}
          </section>`;

        document.getElementById("refreshRoutes")?.addEventListener("click", renderRouteManagement);
    } catch (error) {
        if (SESSION?.token === token && activeWsTab === "routes") {
            panel.innerHTML = `<h4>Route Management</h4><p class="ws-empty">${escapeHtml(error.message)}</p>`;
        }
    }
}


async function renderCourierManagement() {
    const panel = document.getElementById("wsPanel");
    const token = SESSION?.token;
    panel.innerHTML = '<h4>Courier Management</h4><p>Loading couriers and unassigned orders…</p>';
    const headers = { Authorization: `Bearer ${token}` };
    try {
        const [courierRes, orderRes] = await Promise.all([
            fetch(`${Auth.API_BASE}/api/couriers`, { headers }),
            fetch(`${Auth.API_BASE}/api/couriers/unassigned-orders`, { headers })
        ]);
        const [courierData, orderData] = await Promise.all([
            courierRes.json().catch(()=>({})), orderRes.json().catch(()=>({}))
        ]);
        if (!courierRes.ok) throw new Error(courierData.message || `Couriers HTTP ${courierRes.status}`);
        if (!orderRes.ok) throw new Error(orderData.message || `Orders HTTP ${orderRes.status}`);
        if (SESSION?.token !== token || activeWsTab !== "couriers") return;

        const couriers = courierData.couriers || [];
        const available = couriers.filter(c => c.status === "Available" && c.vehicle_id);
        const orders = orderData.orders || [];
        const courierRows = couriers.map(c => `
          <tr><td>#${Number(c.driver_id)}</td>
            <td><strong>${escapeHtml(`${c.first_name} ${c.last_name}`)}</strong><small>${escapeHtml(c.email || "No login")}</small></td>
            <td>${escapeHtml(c.phone)}</td><td>${escapeHtml(c.license_number)}</td>
            <td>${escapeHtml(c.vehicle_type || "—")} · ${escapeHtml(c.plate_number || "No vehicle")}<small>${c.capacity_kg ? `${Number(c.capacity_kg)} kg` : ""}</small></td>
            <td><span class="route-status" data-status="${escapeHtml(c.status)}">${escapeHtml(c.status)}</span></td></tr>`).join("");
        const orderOptions = orders.map(o => `<option value="${Number(o.order_id)}" data-weight="${Number(o.weight_kg)}">#${Number(o.order_id)} · ${escapeHtml(o.pickup_city || "—")} → ${escapeHtml(o.delivery_city || "—")} · ${Number(o.weight_kg)} kg</option>`).join("");
        const courierOptions = available.map(c => `<optgroup label="${escapeHtml(`${c.first_name} ${c.last_name}`)}">${`<option value="${Number(c.driver_id)}" data-vehicle="${Number(c.vehicle_id)}">${escapeHtml(`${c.plate_number} · ${c.vehicle_type} · ${Number(c.capacity_kg)} kg`)}</option>`}</optgroup>`).join("");

        panel.innerHTML = `
          <div class="route-management-head"><div><h4>Courier Management</h4><p class="ws-note">Create real courier accounts, register vehicles and assign eligible local orders.</p></div><button class="ws-link" id="refreshCouriers" type="button">Refresh</button></div>
          <section class="route-form-card"><h5>Add new courier</h5>
            <form id="createCourierForm" class="route-form">
              <div class="route-form-grid">
                <label>First name<input name="first_name" maxlength="80" required></label>
                <label>Last name<input name="last_name" maxlength="80" required></label>
                <label>Phone<input name="phone" maxlength="25" required></label>
                <label>License number<input name="license_number" maxlength="40" required></label>
                <label>Login email<input name="email" type="email" maxlength="254" required></label>
                <label>Temporary password<input name="password" type="password" minlength="8" maxlength="72" required autocomplete="new-password"></label>
                <label>Vehicle type<input name="vehicle_type" placeholder="Car / Van / Motorcycle" required></label>
                <label>Plate number<input name="plate_number" maxlength="30" required></label>
                <label>Capacity (kg)<input name="capacity_kg" type="number" min="0.1" step="0.1" required></label>
              </div>
              <div class="route-form-actions"><button class="btn btn-primary" type="submit">Create courier account</button><span id="courierCreateFeedback" role="status"></span></div>
            </form>
          </section>
          <section class="route-form-card"><h5>Assign courier to local order</h5>
            ${orders.length && available.length ? `<form id="assignCourierForm" class="route-form">
              <label>Unassigned local order<select name="order_id" required>${orderOptions}</select></label>
              <label>Available courier and vehicle<select name="driver_vehicle" required>${available.map(c=>`<option value="${Number(c.driver_id)}:${Number(c.vehicle_id)}">${escapeHtml(`${c.first_name} ${c.last_name} — ${c.plate_number} (${Number(c.capacity_kg)} kg)`)}</option>`).join("")}</select></label>
              <div class="route-form-actions"><button class="btn btn-primary" type="submit">Assign courier</button><span id="courierAssignFeedback" role="status"></span></div>
            </form>` : `<p class="ws-empty">${!orders.length ? "No unassigned local orders are currently waiting." : "No available courier with a registered vehicle. Add a courier or wait until one becomes available."}</p>`}
          </section>
          <section class="route-list-card"><h5>Registered couriers (${couriers.length})</h5>
            ${couriers.length ? `<div class="route-table-wrap"><table class="route-table"><thead><tr><th>ID</th><th>Courier / account</th><th>Phone</th><th>License</th><th>Vehicle</th><th>Status</th></tr></thead><tbody>${courierRows}</tbody></table></div>` : '<p class="ws-empty">No couriers registered yet.</p>'}
          </section>`;
        document.getElementById("refreshCouriers")?.addEventListener("click", renderCourierManagement);
    } catch (error) {
        if (SESSION?.token === token && activeWsTab === "couriers") panel.innerHTML = `<h4>Courier Management</h4><p class="ws-empty">${escapeHtml(error.message)}</p>`;
    }
}

async function renderMyCourierDeliveries() {
    const panel = document.getElementById("wsPanel");
    const token = SESSION?.token;
    panel.innerHTML = '<h4>My deliveries</h4><p>Loading assignments…</p>';
    try {
        const response = await fetch(`${Auth.API_BASE}/api/couriers/me/assignments`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json().catch(()=>({}));
        if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
        if (SESSION?.token !== token || activeWsTab !== "my-deliveries") return;
        panel.innerHTML = `<h4>My deliveries (${(data.assignments||[]).length})</h4>
          ${(data.assignments||[]).map(a=>`<article class="route-form-card"><h5>Order #${Number(a.order_id)} · ${escapeHtml(a.status)}</h5>
            <p class="ws-note">${escapeHtml(`${a.pickup_city||"—"}, ${a.pickup_street||""} → ${a.delivery_city||"—"}, ${a.delivery_street||""}`)}</p>
            <p class="ws-note">Tracking: ${escapeHtml(a.tracking_number||"—")} · ${Number(a.weight_kg)} kg</p>
            ${["Assigned","Picked Up","In Transit"].includes(a.status)?`<label>Update delivery status<select data-courier-status="${Number(a.assignment_id)}">${["Assigned","Picked Up","In Transit","Delivered"].map(s=>`<option ${s===a.status?"selected":""}>${s}</option>`).join("")}</select></label><button class="ws-link" data-courier-save="${Number(a.assignment_id)}">Save status</button>`:""}
          </article>`).join("") || '<p class="ws-empty">No deliveries assigned to you yet.</p>'}`;
    } catch(error) {
        if (SESSION?.token === token && activeWsTab === "my-deliveries") panel.innerHTML=`<h4>My deliveries</h4><p class="ws-empty">${escapeHtml(error.message)}</p>`;
    }
}

async function renderWsPanel(tab) {
    const panel = document.getElementById("wsPanel");
    const u = SESSION.user;

    if (tab === "my-orders" || tab === "all-orders") {
    await renderDatabaseOrders(tab);
    return;
    }

    if (tab === "fulfil") {
        await renderFulfilmentQueue();
        return;
    }
    if (tab === "analytics") {
        await renderAdminAnalytics();
        return;
    }
    if (tab === "routes") {
        await renderRouteManagement();
        return;
    }

    if (tab === "couriers") {
        await renderCourierManagement();
        return;
    }

    if (tab === "my-deliveries") {
        await renderMyCourierDeliveries();
        return;
    }

    if (tab === "users") {
        /* users:read is admin-only. Ask the SERVER — a non-admin gets a real
           403 from middleware/role.js, which is what makes RBAC verifiable. */
        const guard = await Auth.requireAuth("users:read")(SESSION?.token);
        if (!guard.ok) {
            panel.innerHTML = `
                <h4>Users &amp; roles</h4>
                <p class="ws-note">HTTP ${guard.status} — ${guard.error}</p>`;
            return;
        }
        panel.innerHTML = `
            <h4>Users &amp; roles</h4>
            <p class="ws-note">The server allowed this call: <code>GET /api/admin</code> responded 200.
                The role inside the signed token — not anything in the browser — decided that.</p>
            <pre class="ws-json">${JSON.stringify(guard.data, null, 2)}</pre>`;
        return;
    }

    if (tab === "audit") {
        /* audit:read maps to the same admin-only endpoint. */
        const guard = await Auth.requireAuth("audit:read")(SESSION?.token);
        panel.innerHTML = guard.ok
            ? `
                <h4>Audit log</h4>
                <p class="ws-note">HTTP 200 — <code>GET /api/admin</code> allowed for role <strong>${u.role}</strong>.</p>
                <pre class="ws-json">${JSON.stringify(guard.data, null, 2)}</pre>`
            : `
                <h4>Audit log</h4>
                <p class="ws-note">HTTP ${guard.status} — ${guard.error}</p>`;
        return;
    }

    /* security tab — shown to every role */
    panel.innerHTML = `
        <h4>My security</h4>
        <div class="sec-grid">
            <div class="sec-card">
                <span class="sec-label">Password storage</span>
                <p>Hashed with <strong>bcrypt</strong> (10 salt rounds) on the server in
                    <code>routes/auth.js</code>. The plain text never leaves the sign-in form
                    and is never stored.</p>
            </div>
            <div class="sec-card">
                <span class="sec-label">Session token (JWT, HS256)</span>
                <code class="token-cell">JWT stored locally (masked)</code>
                <p>The signed token is stored in browser localStorage and verified by
                    <code>middleware/auth.js</code> on protected API requests. Never share
                    the token or paste it into screenshots.</p>
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
            ${["user", "manager", "admin", "courier"].map(r => `
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
    const save=e.target.closest("[data-courier-save]");
    if (!save) return;
    const id=save.dataset.courierSave;
    const select=document.querySelector(`[data-courier-status="${id}"]`);
    save.disabled=true;
    try {
        const response=await fetch(`${Auth.API_BASE}/api/couriers/me/assignments/${id}/status`,{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:`Bearer ${SESSION?.token}`},body:JSON.stringify({status:select.value})});
        const data=await response.json().catch(()=>({}));
        if(!response.ok) throw new Error(data.message||`HTTP ${response.status}`);
        await renderMyCourierDeliveries();
    } catch(error) { alert(error.message); save.disabled=false; }
});

document.getElementById("wsPanel").addEventListener("submit", async e => {
    if (e.target.id === "createCourierForm") {
        e.preventDefault();
        const form=e.target, feedback=document.getElementById("courierCreateFeedback"), button=form.querySelector('button[type="submit"]');
        const payload=Object.fromEntries(new FormData(form).entries());
        payload.capacity_kg=Number(payload.capacity_kg);
        button.disabled=true; feedback.textContent="Creating courier…";
        try {
            const response=await fetch(`${Auth.API_BASE}/api/couriers`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${SESSION?.token}`},body:JSON.stringify(payload)});
            const data=await response.json().catch(()=>({}));
            if(!response.ok) throw new Error(data.message||`HTTP ${response.status}`);
            feedback.textContent=`Created: ${data.account.email}. Courier can now sign in.`;
            form.reset(); await renderCourierManagement();
        } catch(error) { feedback.textContent=error.message; button.disabled=false; }
        return;
    }
    if (e.target.id === "assignCourierForm") {
        e.preventDefault();
        const form=e.target, feedback=document.getElementById("courierAssignFeedback"), button=form.querySelector('button[type="submit"]');
        const [driver_id,vehicle_id]=form.elements.driver_vehicle.value.split(":").map(Number);
        button.disabled=true; feedback.textContent="Assigning…";
        try {
            const response=await fetch(`${Auth.API_BASE}/api/couriers/assignments`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${SESSION?.token}`},body:JSON.stringify({order_id:Number(form.elements.order_id.value),driver_id,vehicle_id})});
            const data=await response.json().catch(()=>({}));
            if(!response.ok) throw new Error(data.message||`HTTP ${response.status}`);
            feedback.textContent="Courier assigned successfully."; await renderCourierManagement();
        } catch(error) { feedback.textContent=error.message; button.disabled=false; }
        return;
    }
    if (e.target.id !== "createRouteForm") return;
    e.preventDefault();
    const form = e.target;
    const feedback = document.getElementById("routeFormFeedback");
    const submitButton = form.querySelector('button[type="submit"]');
    const driverSelect = form.elements.driver_id;
    const selectedDriverOption = driverSelect.selectedOptions[0];
    const payload = {
        driver_id: Number(driverSelect.value),
        vehicle_id: Number(selectedDriverOption?.dataset.vehicle),
        from_depot_id: Number(form.elements.from_depot_id.value),
        to_depot_id: Number(form.elements.to_depot_id.value),
        departure_time: form.elements.departure_time.value,
        distance_km: Number(form.elements.distance_km.value)
    };
    submitButton.disabled = true;
    feedback.textContent = "Creating route…";
    feedback.className = "route-feedback";
    try {
        const response = await fetch(`${Auth.API_BASE}/api/routes`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SESSION?.token}` },
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
        toast(`Route #${data.route.route_id} created`);
        await renderRouteManagement();
    } catch (error) {
        feedback.textContent = error.message;
        feedback.className = "route-feedback error";
        submitButton.disabled = false;
    }
});

document.getElementById("wsPanel").addEventListener("click", async e => {
    const cancelRouteButton = e.target.closest("[data-cancel-route]");
    if (cancelRouteButton) {
        const routeId = cancelRouteButton.dataset.cancelRoute;
        if (!confirm(`Cancel planned route #${routeId}?`)) return;
        cancelRouteButton.disabled = true;
        try {
            const response = await fetch(`${Auth.API_BASE}/api/routes/${encodeURIComponent(routeId)}/cancel`, {
                method: "PATCH", headers: { Authorization: `Bearer ${SESSION?.token}` }
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
            toast(`Route #${routeId} cancelled`);
            await renderRouteManagement();
        } catch (error) {
            toast(`Could not cancel route: ${error.message}`);
            cancelRouteButton.disabled = false;
        }
        return;
    }
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
        const trackingNumber = saveStatus.dataset.saveStatus;
        const select = [...document.querySelectorAll("[data-status-for]")]
            .find(element => element.dataset.statusFor === trackingNumber);
        if (!select) return;
        saveStatus.disabled = true;
        saveStatus.textContent = "Saving...";
        try {
            const result = await Auth.fetch(
                `/api/tracking/${encodeURIComponent(trackingNumber)}/status`,
                { method: "PATCH", body: { status: select.value }, token: SESSION?.token }
            );
            if (!result.ok) throw new Error(result.data?.message || result.error || `HTTP ${result.status}`);
            toast(`Order #${result.data.order_id} → ${result.data.status}`);
            await renderFulfilmentQueue();
        } catch (error) {
            toast(`Could not update status: ${error.message}`);
            saveStatus.disabled = false;
            saveStatus.textContent = "Save";
        }
        return;
    }

    /* Protected: users:update:role — the server re-checks the admin role. */
    const saveRole = e.target.closest("[data-save-role]");
    if (saveRole) {
        const guard = await Auth.requireAuth("users:update:role")(SESSION?.token);
        if (!guard.ok) return toast(`403 · ${guard.error}`);
        /* The backend has no "change role" route yet, so the UI reports the
           server's verdict instead of pretending the change was persisted. */
        toast("The API allows this, but no role-update endpoint exists yet.");
        return;
    }
});

/* ---- auth-related wiring ---- */
if (HAS_AUTH_UI) {
    document.getElementById("loginBtn").addEventListener("click", () => openAuth("login"));
    document.getElementById("closeAuth").addEventListener("click", closeAuth);
    authOverlay.addEventListener("click", e => { if (e.target === authOverlay) closeAuth(); });
    document.querySelectorAll("[data-auth-tab]").forEach(btn =>
        btn.addEventListener("click", () => switchAuthTab(btn.dataset.authTab)));
    document.getElementById("regPassword").addEventListener("input", e => updatePwRules(e.target.value));
}

/* ---- demo sign-in: click a role, the backend issues a real JWT ---- */
/* The demo accounts now live in PostgreSQL. The password shown on each button
   is the one the backend stored, so this performs a genuine login. */
if (HAS_AUTH_UI) document.querySelectorAll(".demo-account").forEach(btn => btn.addEventListener("click", async () => {
    try {
        const res = await Auth.login({
            email: btn.dataset.email,
            password: btn.dataset.password
        });
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
   here goes through the real API, so the 403/200 below come from the server.
   -------------------------------------------------------------------------- */
const DEMO_PASSWORDS = { user: "User1234", manager: "Manager1234", admin: "Admin1234" };

window.DEMO = {
    /* Sign in as a role on the console, then call a permission-guarded endpoint:
           await DEMO.api('user',  'users:read')   -> 403 Forbidden
           await DEMO.api('admin', 'users:read')   -> 200 OK            */
    api: async (role, permission) => {
        const account = Auth.SEED_ACCOUNTS.find(a => a.role === role);
        if (!account) return { ok: false, status: 404, error: `No demo account with role "${role}".` };

        const login = await Auth.login({ email: account.email, password: account.password });
        if (!login.ok) return login;

        const result = await Auth.requireAuth(permission)(login.token);
        console.table([{ call: `${role} -> ${permission}`, status: result.status, allowed: result.ok }]);
        return result;
    },

    /* Sign in as a role from the console (also what the modal buttons use):
           await DEMO.login('manager')                                        */
    login: async role => {
        const account = Auth.SEED_ACCOUNTS.find(a => a.role === role);
        if (!account) return { ok: false, status: 404, error: `No demo account with role "${role}".` };
        const res = await Auth.login({ email: account.email, password: account.password });
        if (res.ok) applySession({ token: res.token, user: res.user, session_id: res.session_id });
        return res;
    },

    /* The demo accounts the UI offers. The rows themselves live in PostgreSQL. */
    accounts: () => Auth.SEED_ACCOUNTS.map(a => ({ email: a.email, role: a.role, password: a.password })),

    logout: () => logout(),
    session: () => SESSION
};

/* --------------------------------------------------------------------------
   DIAGNOSTICS
   --------------------------------------------------------------------------
   If sign-in ever "does nothing", run `checkAuth()` in the browser console. It
   pings the API and reports exactly which prerequisite is missing.
   -------------------------------------------------------------------------- */
async function checkAuth() {
    const report = {
        page: location.href,
        apiBase: Auth.API_BASE,
        loggedIn: SESSION ? SESSION.user.email : null,
        apiReachable: null,
        problem: null
    };

    try {
        const res = await fetch(Auth.API_BASE + "/");
        report.apiReachable = res.ok;
    } catch {
        report.apiReachable = false;
    }

    if (!report.apiReachable) {
        report.problem = `The API at ${Auth.API_BASE} is not answering. Start it with: ` +
            `cd backend/backend && npm start`;
    } else {
        report.problem = "none — the API is reachable, sign-in should work";
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
    /* Demo accounts are authenticated against PostgreSQL; the frontend does
       not create or seed users. */

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
