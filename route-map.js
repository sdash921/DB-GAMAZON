/* GAmazon map preview: Leaflet + OpenStreetMap + OSRM + Open-Meteo.
   This is a planning estimate, not live traffic telemetry. */
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
    let pickupMarker = null, deliveryMarker = null, routeLayer = null;
    let nextMapPoint = "pickup";
    const selectedAddress = { pickup: null, delivery: null };
    const suggestionTimers = { pickup: null, delivery: null };

    const coords = {
        pickup: null,
        delivery: null
    };
    const escapeText = value => String(value).replace(/[&<>"']/g, ch => ({
        "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    })[ch]);

    function setPoint(kind, lat, lon, label) {
        coords[kind] = { lat: Number(lat), lon: Number(lon) };
        const marker = kind === "pickup" ? pickupMarker : deliveryMarker;
        if (marker) map.removeLayer(marker);
        const title = kind === "pickup" ? "Pickup" : "Delivery";
        const next = L.marker([lat, lon]).addTo(map).bindPopup(`${title}: ${escapeText(label || "Selected point")}`);
        if (kind === "pickup") pickupMarker = next;
        else deliveryMarker = next;
        fields(`${kind}_lat`).value = Number(lat).toFixed(7);
        fields(`${kind}_lon`).value = Number(lon).toFixed(7);
    }

    function addressQuery(kind) {
        const city = fields(`${kind}_city`).value.trim();
        const street = fields(`${kind}_street`).value.trim();
        const building = fields(`${kind}_building`).value.trim();
        if (!city || !street || !building) return "";
        return `${street} ${building}, ${city}, Казахстан`;
    }

    function renderSuggestions(kind, features) {
        const panel = document.getElementById(`${kind}AddressSuggestions`);
        if (!panel) return;
        panel.replaceChildren();
        if (!features.length) { panel.hidden = true; return; }
        features.forEach(feature => {
            const props = feature.properties || {};
            const button = document.createElement("button");
            button.type = "button";
            button.className = "address-suggestion";
            button.setAttribute("role", "option");
            button.textContent = props.label || [props.name, props.street, props.housenumber, props.city].filter(Boolean).join(", ");
            button.addEventListener("click", () => {
                const streetValue = props.street || props.name || "";
                const houseValue = props.housenumber || "";
                if (streetValue) fields(`${kind}_street`).value = streetValue;
                if (houseValue) fields(`${kind}_building`).value = houseValue;
                if (props.city) fields(`${kind}_city`).value = props.city;
                const [lon, lat] = feature.geometry.coordinates;
                setPoint(kind, lat, lon, button.textContent);
                selectedAddress[kind] = { query: addressQuery(kind), lat, lon, label: button.textContent };
                panel.hidden = true;
                note.textContent = `${kind === "pickup" ? "Адрес отправления" : "Адрес доставки"} выбран. Квартира и подъезд указываются отдельно и не влияют на координаты здания.`;
            });
            panel.appendChild(button);
        });
        panel.hidden = false;
    }

    async function searchAddressSuggestions(kind) {
        const query = addressQuery(kind);
        const panel = document.getElementById(`${kind}AddressSuggestions`);
        if (!query || query.length < 5) { if (panel) panel.hidden = true; return; }
        try {
            const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lang=ru&lat=43.2383&lon=76.9455`;
            const response = await fetch(url, { headers: { "Accept":"application/json" } });
            if (!response.ok) throw new Error("Address suggestions unavailable");
            const data = await response.json();
            renderSuggestions(kind, (data.features || []).filter(item =>
                item.geometry?.coordinates?.length === 2 &&
                item.properties?.countrycode?.toLowerCase() === "kz"
            ));
        } catch (error) {
            if (panel) panel.hidden = true;
            console.warn("Address autocomplete:", error.message);
        }
    }

    async function geocodeAddress(kind) {
        const query = addressQuery(kind);
        if (!query) throw new Error(`Заполните город, улицу и номер дома (${kind === "pickup" ? "отправление" : "доставка"}).`);
        const selected = selectedAddress[kind];
        if (selected && selected.query === query) return selected;

        const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1&lang=ru&lat=43.2383&lon=76.9455`;
        const photonResponse = await fetch(photonUrl, { headers: { "Accept":"application/json" } });
        if (photonResponse.ok) {
            const photonData = await photonResponse.json();
            const feature = (photonData.features || []).find(item =>
                item.geometry?.coordinates?.length === 2 &&
                item.properties?.countrycode?.toLowerCase() === "kz"
            );
            if (feature) {
                const [lon, lat] = feature.geometry.coordinates;
                return { lat:Number(lat), lon:Number(lon), label:feature.properties.label || query };
            }
        }

        const fallbackUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=kz&accept-language=ru&q=${encodeURIComponent(query)}`;
        const fallbackResponse = await fetch(fallbackUrl, { headers: { "Accept":"application/json" } });
        if (!fallbackResponse.ok) throw new Error("Сервис поиска адресов временно недоступен.");
        const results = await fallbackResponse.json();
        if (!results.length) throw new Error(`Не удалось найти адрес: ${query}. Выберите подсказку или уточните улицу и дом.`);
        return { lat:Number(results[0].lat), lon:Number(results[0].lon), label:results[0].display_name };
    }

    async function getWeather(lat, lon) {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,rain,snowfall,wind_speed_10m,weather_code&timezone=Asia%2FAlmaty`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("Weather service is unavailable.");
        const data = await response.json();
        return data.current || {};
    }

    function weatherDescription(current) {
        const code = Number(current.weather_code);
        if (current.snowfall > 0 || [71,73,75,77,85,86].includes(code)) return "Snow";
        if (current.precipitation > 0 || current.rain > 0 || [51,53,55,61,63,65,80,81,82].includes(code)) return "Rain";
        if ([45,48].includes(code)) return "Fog";
        if (current.wind_speed_10m >= 40) return "Strong wind";
        return "No significant precipitation";
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
        summary.textContent = "Ищем адреса и рассчитываем маршрут…";
        try {
            const pickup = await geocodeAddress("pickup");
            setPoint("pickup", pickup.lat, pickup.lon, pickup.label);
            await new Promise(resolve => setTimeout(resolve, 1100)); // respect Nominatim's public rate limit
            const delivery = await geocodeAddress("delivery");
            setPoint("delivery", delivery.lat, delivery.lon, delivery.label);

            const routeUrl = `https://router.project-osrm.org/route/v1/driving/${pickup.lon},${pickup.lat};${delivery.lon},${delivery.lat}?overview=full&geometries=geojson&steps=true`;
            const routeResponse = await fetch(routeUrl);
            if (!routeResponse.ok) throw new Error("Сервис построения маршрута временно недоступен.");
            const routeData = await routeResponse.json();
            if (routeData.code !== "Ok" || !routeData.routes?.length) throw new Error("Автомобильный маршрут между адресами не найден.");
            const route = routeData.routes[0];
            if (routeLayer) map.removeLayer(routeLayer);
            routeLayer = L.geoJSON(route.geometry, { style: { color:"#2456d8", weight:6, opacity:.85 } }).addTo(map);
            const bounds = L.latLngBounds([ [pickup.lat,pickup.lon], [delivery.lat,delivery.lon] ]);
            map.fitBounds(routeLayer.getBounds().pad(0.15));

            const weather = await getWeather(delivery.lat, delivery.lon);
            const factor = weatherMultiplier(weather);
            const baseMinutes = route.duration / 60;
            const adjustedMinutes = Math.ceil(baseMinutes * factor);
            const distanceKm = route.distance / 1000;
            fields("route_distance_km").value = distanceKm.toFixed(2);
            fields("route_duration_min").value = Math.round(baseMinutes);
            fields("weather_factor").value = factor.toFixed(2);
            const weatherText = weatherDescription(weather);
            summary.innerHTML = `
                <span>Расстояние: ${distanceKm.toFixed(1)} км</span>
                <span>Время по дорогам: ${Math.ceil(baseMinutes)} мин</span>
                <span>Погода: ${escapeText(weatherText)} · ${Math.round(weather.temperature_2m)}°C</span>
                <span>Оценка с погодой: ${adjustedMinutes} мин</span>`;
            note.textContent = `Поправка на погоду: ${Math.round((factor - 1) * 100)}%. Это демонстрационная оценка, не данные о пробках. Погода проверяется рядом с адресом доставки.`;
            fields("pickup_lat").dispatchEvent(new Event("change", { bubbles:true }));
        } catch (error) {
            summary.textContent = error.message || "Could not calculate route.";
            note.textContent = "Check the addresses and try again. You can also select approximate points directly on the map.";
        } finally {
            buildButton.disabled = false;
            buildButton.textContent = "Построить маршрут";
        }
    }

    buildButton.addEventListener("click", buildRoute);
    map.on("click", event => {
        const kind = nextMapPoint;
        setPoint(kind, event.latlng.lat, event.latlng.lng, "Map selection");
        nextMapPoint = kind === "pickup" ? "delivery" : "pickup";
        note.textContent = `Выбрана точка ${kind === "pickup" ? "отправления" : "доставки"}. Следующий клик выберет ${nextMapPoint === "pickup" ? "отправление" : "доставку"}. После выбора обеих точек нажмите «Построить маршрут».`;
    });

    // Russian/English address autocomplete with a short debounce.
    ["pickup", "delivery"].forEach(kind => {
        ["city", "street", "building"].forEach(part => {
            const input = fields(`${kind}_${part}`);
            input.addEventListener("input", () => {
                selectedAddress[kind] = null;
                clearTimeout(suggestionTimers[kind]);
                suggestionTimers[kind] = setTimeout(() => searchAddressSuggestions(kind), 650);
            });
        });
    });

    // Default to Almaty for a local-delivery-first experience.
    ["pickup_city","delivery_city"].forEach(name => {
        const input = fields(name);
        if (input && !input.value) input.value = "Almaty";
    });
    setTimeout(() => map.invalidateSize(), 250);
    window.addEventListener("resize", () => map.invalidateSize());
    window.GAmazonRouteMap = { buildRoute };
})();
