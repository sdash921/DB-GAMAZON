
const DELIVERY_API_BASE = "http://localhost:3000";
console.log("DELIVERY JS LOADED");
async function deliveryRequest(path, options = {}) {
    const session = JSON.parse(
        localStorage.getItem("gamazon.session") || "null"
    );

    const result = await Auth.fetch(path, {
        method: options.method || "GET",
        body: options.body ? JSON.parse(options.body) : undefined,
        token: session?.token
    });

    if (!result.ok) {
        throw new Error(result.error || "Request failed");
    }

    return result.data;
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
