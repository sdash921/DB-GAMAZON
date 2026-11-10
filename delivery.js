/* GAmazon delivery-request API integration.
   Auth.fetch handles JSON serialization and the Bearer token. */
console.log("GAmazon delivery module loaded");

async function deliveryRequest(path, { method = "GET", body } = {}) {
    const session = JSON.parse(localStorage.getItem("gamazon.session") || "null");
    const result = await Auth.fetch(path, {
        method,
        body,
        token: session?.token
    });
    if (!result.ok) throw new Error(result.error || `Request failed (${result.status})`);
    return result.data;
}

async function createDeliveryRequest(data) {
    return deliveryRequest("/api/delivery-requests", { method: "POST", body: data });
}
async function getDeliveryOptions(requestId) {
    return deliveryRequest(`/api/delivery-requests/${encodeURIComponent(requestId)}/options`);
}
async function confirmDelivery(requestId, routeId) {
    return deliveryRequest(`/api/delivery-requests/${encodeURIComponent(requestId)}/confirm`, {
        method: "POST", body: { route_id: Number(routeId) }
    });
}
async function trackDelivery(trackingNumber) {
    return deliveryRequest(`/api/tracking/${encodeURIComponent(trackingNumber)}`);
}

(function initDeliveryRequestUI() {
    const form = document.getElementById("deliveryRequestForm");
    if (!form) return;

    const feedback = document.getElementById("deliveryFeedback");
    const results = document.getElementById("deliveryResults");
    const submit = document.getElementById("findDeliveryRoutes");
    const authNote = document.getElementById("deliveryAuthNote");
    const dateInput = form.elements.namedItem("requested_date");

    const today = new Date();
    const localToday = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
    dateInput.min = localToday;
    dateInput.value = localToday;

    function sessionNow() {
        try { return JSON.parse(localStorage.getItem("gamazon.session") || "null"); }
        catch { return null; }
    }
    function showMessage(message, success = false) {
        feedback.textContent = message;
        feedback.classList.toggle("success", success);
    }
    function requireCustomer() {
        const session = sessionNow();
        if (!session?.token) throw new Error("Please sign in first. Delivery requests are available to Customer accounts.");
        const role = String(session.user?.role || "").toLowerCase();
        if (role !== "user" && role !== "customer") {
            throw new Error("Sign in with a Customer account to create a delivery request.");
        }
        return session;
    }
    function formatDate(value) {
        if (!value) return "—";
        return new Date(value).toLocaleString("en-GB", { dateStyle:"medium", timeStyle:"short" });
    }
    function optionCard(option, requestId, index) {
        const driver = [option.driver_first_name, option.driver_last_name].filter(Boolean).join(" ") || `Driver #${option.driver_id}`;
        return `
          <article class="delivery-option">
            <div class="delivery-option-head"><strong>Route #${option.route_id}</strong><span class="delivery-option-badge">Available</span></div>
            <div class="delivery-option-grid">
              <div><span>Departure</span><b>${formatDate(option.departure_time)}</b></div>
              <div><span>Arrival</span><b>${formatDate(option.arrival_time)}</b></div>
              <div><span>Driver</span><b>${escapeHtml(driver)}</b></div>
              <div><span>Vehicle</span><b>${escapeHtml(option.vehicle_type || "Vehicle")} · ${escapeHtml(option.plate_number || "—")}</b></div>
              <div><span>Distance</span><b>${option.distance_km ?? "—"} km</b></div>
              <div><span>Capacity</span><b>${option.capacity_kg ?? "—"} kg</b></div>
            </div>
            <button class="btn btn-primary" type="button" data-confirm-route="${option.route_id}" data-request-id="${requestId}">Choose this route</button>
          </article>`;
    }

    form.addEventListener("submit", async event => {
        event.preventDefault();
        try {
            requireCustomer();
            submit.disabled = true;
            submit.textContent = "Searching routes…";
            results.innerHTML = '<div class="delivery-empty">Creating your request and searching for suitable routes…</div>';
            showMessage("");

            const value = name => form.elements.namedItem(name).value.trim();
            const numberOrNull = name => value(name) ? Number(value(name)) : null;
            const payload = {
                pickup: { city:value("pickup_city"), street:value("pickup_street"), building:value("pickup_building"), apartment:value("pickup_apartment") || null },
                delivery: { city:value("delivery_city"), street:value("delivery_street"), building:value("delivery_building"), apartment:value("delivery_apartment") || null },
                weight_kg:Number(value("weight_kg")),
                length_cm:numberOrNull("length_cm"),
                width_cm:numberOrNull("width_cm"),
                height_cm:numberOrNull("height_cm"),
                delivery_type:value("delivery_type"),
                requested_date:value("requested_date")
            };
            const created = await createDeliveryRequest(payload);
            const requestId = created.request?.request_id;
            if (!requestId) throw new Error("The server created a request but did not return its ID.");

            const data = await getDeliveryOptions(requestId);
            showMessage(`Request #${requestId} created. ${data.options_count} matching route(s) found.`, true);
            if (!data.options?.length) {
                results.innerHTML = `<div class="delivery-empty">Request #${requestId} was saved, but no route currently matches ${escapeHtml(payload.pickup.city)} → ${escapeHtml(payload.delivery.city)} on or after ${escapeHtml(payload.requested_date)}. Try another date or city pair.</div>`;
                return;
            }
            results.innerHTML = data.options.map((option, index) => optionCard(option, requestId, index)).join("");
        } catch (error) {
            showMessage(error.message || "Could not create delivery request.");
            results.innerHTML = '<div class="delivery-empty">No route results to show. Correct the form or sign in, then try again.</div>';
        } finally {
            submit.disabled = false;
            submit.textContent = "Find available routes";
        }
    });

    results.addEventListener("click", async event => {
        const button = event.target.closest("[data-confirm-route]");
        if (!button) return;
        try {
            requireCustomer();
            button.disabled = true;
            button.textContent = "Confirming…";
            const confirmed = await confirmDelivery(button.dataset.requestId, button.dataset.confirmRoute);
            const tracking = confirmed.parcel?.tracking_number;
            results.innerHTML = `
              <div class="delivery-confirmed">
                <strong>Delivery confirmed!</strong><br>
                Your order #${confirmed.order?.order_id ?? "—"} has been created.<br>
                Tracking number:<br><code>${escapeHtml(tracking || "Not returned")}</code><br>
                Save this number to track your parcel in the section below.
                ${tracking ? `<button type="button" class="btn btn-primary" id="trackNewParcel" data-tracking="${escapeHtml(tracking)}">Track parcel</button>` : ""}
              </div>`;
            showMessage("Route successfully assigned. Your parcel is now in the system.", true);
        } catch (error) {
            button.disabled = false;
            button.textContent = "Choose this route";
            showMessage(error.message || "Could not confirm this route.");
        }
    });

    results.addEventListener("click", event => {
        const trackButton = event.target.closest("#trackNewParcel");
        if (!trackButton) return;
        const input = document.getElementById("orderInput");
        input.value = trackButton.dataset.tracking;
        document.getElementById("track").scrollIntoView({ behavior:"smooth" });
        trackOrder();
    });

    window.addEventListener("storage", event => {
        if (event.key === "gamazon.session") {
            authNote.textContent = sessionNow()?.token
                ? "Signed in. You can create a delivery request."
                : "Sign in with a Customer account to create a delivery request.";
        }
    });
    authNote.textContent = sessionNow()?.token
        ? "You are signed in. Delivery requests require the Customer role."
        : "Sign in with a Customer account to create a delivery request.";
})();
