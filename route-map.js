/* GAmazon map preview: address <-> map synchronization, OSRM roads and Open-Meteo estimate. */
(function initRouteMap() {
    const mapElement = document.getElementById("deliveryMap");
    const form = document.getElementById("deliveryRequestForm");
    if (!mapElement || !form || !window.L) return;

    const map = L.map(mapElement).setView([43.2383, 76.9455], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    const fields = name => form.elements.namedItem(name);
    const summary = document.getElementById("routeMapSummary");
    const note = document.getElementById("routeMapNote");
    const buildButton = document.getElementById("buildRoutePreview");
    const pickupButton = document.getElementById("selectPickupPoint");
    const deliveryButton = document.getElementById("selectDeliveryPoint");
    let pickupMarker = null, deliveryMarker = null, routeLayer = null;
    let activePoint = "pickup";
    const coords = { pickup: null, delivery: null };

    const escapeText = value => String(value).replace(/[&<>"']/g, ch => ({
        "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    })[ch]);

    function setActivePoint(kind) {
        activePoint = kind;
        pickupButton.classList.toggle("is-active", kind === "pickup");
        deliveryButton.classList.toggle("is-active", kind === "delivery");
        pickupButton.setAttribute("aria-pressed", String(kind === "pickup"));
        deliveryButton.setAttribute("aria-pressed", String(kind === "delivery"));
        note.textContent = kind === "pickup"
            ? "Режим выбора отправления: нажмите на карту в месте забора посылки."
            : "Режим выбора доставки: нажмите на карту в месте получения посылки.";
    }

    function removeRoutePreview() {
        if (routeLayer) map.removeLayer(routeLayer);
        routeLayer = null;
        fields("route_distance_km").value = "";
        fields("route_duration_min").value = "";
        fields("weather_factor").value = "";
        summary.textContent = "Маршрут ещё не построен.";
    }

    function setPoint(kind, lat, lon, label) {
        coords[kind] = { lat: Number(lat), lon: Number(lon) };
        const oldMarker = kind === "pickup" ? pickupMarker : deliveryMarker;
        if (oldMarker) map.removeLayer(oldMarker);
        const title = kind === "pickup" ? "Отправление" : "Доставка";
        const marker = L.marker([lat, lon]).addTo(map).bindPopup(`${title}: ${escapeText(label || "Точка на карте")}`);
        if (kind === "pickup") pickupMarker = marker;
        else deliveryMarker = marker;
        fields(`${kind}_lat`).value = Number(lat).toFixed(7);
        fields(`${kind}_lon`).value = Number(lon).toFixed(7);
    }

    function clearPoint(kind) {
        coords[kind] = null;
        fields(`${kind}_lat`).value = "";
        fields(`${kind}_lon`).value = "";
        const marker = kind === "pickup" ? pickupMarker : deliveryMarker;
        if (marker) map.removeLayer(marker);
        if (kind === "pickup") pickupMarker = null;
        else deliveryMarker = null;
        removeRoutePreview();
    }

    async function reverseGeocode(kind, lat, lon) {
        note.textContent = "Определяем адрес выбранной точки…";
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=ru`;
        const response = await fetch(url, { headers: { "Accept": "application/json" } });
        if (!response.ok) throw new Error("Не удалось определить адрес. Координаты точки сохранены; заполните город вручную.");
        const data = await response.json();
        const address = data.address || {};
        const city = address.city || address.town || address.village || address.municipality || address.county || "";
        const street = address.road || address.pedestrian || address.residential || address.footway || "Выбрано на карте";
        fields(`${kind}_city`).value = city;
        const building = address.house_number || "Точка на карте";
        if (city) fields(`${kind}_city`).value = city;
        fields(`${kind}_street`).value = street;
        fields(`${kind}_building`).value = building;
        const label = [street, address.house_number, city].filter(Boolean).join(", ") || "Точка на карте";
        const marker = kind === "pickup" ? pickupMarker : deliveryMarker;
        if (marker) marker.setPopupContent(`${kind === "pickup" ? "Отправление" : "Доставка"}: ${escapeText(label)}`);
        note.textContent = `${kind === "pickup" ? "Отправление" : "Доставка"}: ${label}. Координаты точки сохранены.`;
        if (!city) note.textContent += " Город не распознан — укажите его в поле «Город».";
    }

    async function geocodeAddress(kind) {
        const city = fields(`${kind}_city`).value.trim();
        const street = fields(`${kind}_street`).value.trim();
        const building = fields(`${kind}_building`).value.trim();
        if (!city || !street || !building) throw new Error(`Для ${kind === "pickup" ? "отправления" : "доставки"} выберите точку на карте или заполните город, улицу и дом.`);
        const query = `${building} ${street}, ${city}, Kazakhstan`;
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=kz&q=${encodeURIComponent(query)}`;
        const response = await fetch(url, { headers: { "Accept":"application/json" } });
        if (!response.ok) throw new Error("Сервис поиска адресов временно недоступен.");
        const results = await response.json();
        if (!results.length) throw new Error(`Адрес не найден: ${query}. Уточните улицу или выберите точку на карте.`);
        return { lat:Number(results[0].lat), lon:Number(results[0].lon), label:results[0].display_name };
    }

    async function resolvePoint(kind) {
        const storedLat = fields(`${kind}_lat`).value;
        const storedLon = fields(`${kind}_lon`).value;
        if (coords[kind] && storedLat && storedLon) return { ...coords[kind], label:"Точка на карте" };
        const point = await geocodeAddress(kind);
        setPoint(kind, point.lat, point.lon, point.label);
        return point;
    }

    async function getWeather(lat, lon) {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,rain,snowfall,wind_speed_10m,weather_code&timezone=Asia%2FAlmaty`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("Сервис погоды временно недоступен.");
        const data = await response.json();
        return data.current || {};
    }

    function weatherDescription(current) {
        const code = Number(current.weather_code);
        if (current.snowfall > 0 || [71,73,75,77,85,86].includes(code)) return "Снег";
        if (current.precipitation > 0 || current.rain > 0 || [51,53,55,61,63,65,80,81,82].includes(code)) return "Дождь";
        if ([45,48].includes(code)) return "Туман";
        if (current.wind_speed_10m >= 40) return "Сильный ветер";
        return "Без существенных осадков";
    }

    function weatherMultiplier(current) {
        let factor = 1;
        const code = Number(current.weather_code);
        if (current.snowfall > 0 || [71,73,75,77,85,86].includes(code)) factor += 0.25;
        else if (current.precipitation > 1 || current.rain > 1 || [61,63,65,80,81,82].includes(code)) factor += 0.15;
        else if ([45,48].includes(code)) factor += 0.10;
        if (current.wind_speed_10m >= 40) factor += 0.10;
        return Math.min(factor, 1.5);
    }

    async function buildRoute() {
        buildButton.disabled = true;
        buildButton.textContent = "Строим…";
        summary.textContent = "Получаем координаты и строим маршрут по дорогам…";
        try {
            const pickup = await resolvePoint("pickup");
            await new Promise(resolve => setTimeout(resolve, 1100));
            const delivery = await resolvePoint("delivery");
            const routeUrl = `https://router.project-osrm.org/route/v1/driving/${pickup.lon},${pickup.lat};${delivery.lon},${delivery.lat}?overview=full&geometries=geojson&steps=true`;
            const routeResponse = await fetch(routeUrl);
            if (!routeResponse.ok) throw new Error("Сервис построения маршрута временно недоступен.");
            const routeData = await routeResponse.json();
            if (routeData.code !== "Ok" || !routeData.routes?.length) throw new Error("Автомобильный маршрут между этими точками не найден.");
            const route = routeData.routes[0];
            if (routeLayer) map.removeLayer(routeLayer);
            routeLayer = L.geoJSON(route.geometry, { style: { color:"#2456d8", weight:6, opacity:.85 } }).addTo(map);
            map.fitBounds(routeLayer.getBounds().pad(0.15));

            const weather = await getWeather(delivery.lat, delivery.lon);
            const factor = weatherMultiplier(weather);
            const baseMinutes = route.duration / 60;
            const adjustedMinutes = Math.ceil(baseMinutes * factor);
            const distanceKm = route.distance / 1000;
            fields("route_distance_km").value = distanceKm.toFixed(2);
            fields("route_duration_min").value = Math.round(baseMinutes);
            fields("weather_factor").value = factor.toFixed(2);
            summary.innerHTML = `<span>Расстояние: ${distanceKm.toFixed(1)} км</span><span>По дорогам: ${Math.ceil(baseMinutes)} мин</span><span>Погода: ${escapeText(weatherDescription(weather))} · ${Math.round(weather.temperature_2m)}°C</span><span>С учётом погоды: ${adjustedMinutes} мин</span>`;
            note.textContent = "Маршрут рассчитан по дорожной сети. Поправка на погоду — демонстрационная оценка; данные о пробках в реальном времени не используются.";
        } catch (error) {
            summary.textContent = error.message || "Не удалось построить маршрут.";
        } finally {
            buildButton.disabled = false;
            buildButton.textContent = "Построить маршрут";
        }
    }

    pickupButton.addEventListener("click", () => setActivePoint("pickup"));
    deliveryButton.addEventListener("click", () => setActivePoint("delivery"));
    buildButton.addEventListener("click", buildRoute);

    map.on("click", async event => {
        const kind = activePoint;
        setPoint(kind, event.latlng.lat, event.latlng.lng, "Точка на карте");
        // Keep the pin usable even if reverse-geocoding is temporarily unavailable.
        fields(`${kind}_city`).value = "";
        fields(`${kind}_street`).value = "Выбрано на карте";
        fields(`${kind}_building`).value = "Точка на карте";
        removeRoutePreview();
        try {
            await reverseGeocode(kind, event.latlng.lat, event.latlng.lng);
        } catch (error) {
            note.textContent = error.message;
        }
        // After setting pickup, automatically arm delivery mode for the next click.
        if (kind === "pickup") setActivePoint("delivery");
        else setActivePoint("pickup");
    });

    // Editing an address manually invalidates its old pin, preventing mismatched coordinates.
    ["pickup", "delivery"].forEach(kind => {
        ["city", "street", "building"].forEach(part => {
            fields(`${kind}_${part}`).addEventListener("input", () => clearPoint(kind));
        });
    });

    ["pickup_city", "delivery_city"].forEach(name => {
        const input = fields(name);
        if (input && !input.value) input.value = "Almaty";
    });
    setActivePoint("pickup");
    setTimeout(() => map.invalidateSize(), 250);
    window.addEventListener("resize", () => map.invalidateSize());
    window.GAmazonRouteMap = { buildRoute, setActivePoint };
})();
