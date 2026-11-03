
const API_BASE = "http://localhost:3000";

async function deliveryRequest(path, options = {}) {
    const token = localStorage.getItem("token");

    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...options.headers
        }
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || data.message || "Request failed");
    }

    return data;
}

// Создание заявки на доставку
async function createDeliveryRequest(deliveryData) {
    return deliveryRequest("/api/delivery-requests", {
        method: "POST",
        body: JSON.stringify(deliveryData)
    });
}

// Получение доступных маршрутов
async function getDeliveryOptions(requestId) {
    return deliveryRequest(
        `/api/delivery-requests/${requestId}/options`
    );
}

// Подтверждение выбранного маршрута
async function confirmDelivery(requestId, routeId) {
    return deliveryRequest(
        `/api/delivery-requests/${requestId}/confirm`,
        {
            method: "POST",
            body: JSON.stringify({ route_id: routeId })
        }
    );
}

// Отслеживание посылки
async function trackDelivery(trackingNumber) {
    return deliveryRequest(
        `/api/tracking/${encodeURIComponent(trackingNumber)}`
    );
}
