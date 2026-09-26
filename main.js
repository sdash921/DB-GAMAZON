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
    closeCart();
}

function closeCheckout() {
    checkoutOverlay.hidden = true;
    /* Return the modal to the checkout step so reopening never shows a stale
       confirmation screen from a previous order. */
    checkoutStep.hidden = false;
    confirmStep.hidden = true;
    modalTitle.textContent = "Checkout";
}

checkoutForm.addEventListener("submit", e => {
    e.preventDefault();
    const name = document.getElementById("fName").value.trim();
    const email = document.getElementById("fEmail").value.trim();
    const address = document.getElementById("fAddress").value.trim();

    const { lines } = getCartDetailed();
    const customerId = upsertCustomer({ name, email, address });
    const orderNumber = createOrder({ customerId, address, lines });

    /* Empty the cart once the order is saved. */
    CART = [];
    renderCart();

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

/* --------------------------------------------------------------------------
   INIT
   -------------------------------------------------------------------------- */
seedDemoOrders();
renderChips();
renderProducts();
renderCart();
showTrackingPlaceholder("Enter an order number above to see its delivery progress.");
document.getElementById("year").textContent = new Date().getFullYear();