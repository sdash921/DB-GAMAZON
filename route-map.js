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

    async function geocodeAddress(kind) {
        const city = fields(`${kind}_city`).value.trim();
        const street = fields(`${kind}_street`).value.trim();
        const building = fields(`${kind}_building`).value.trim();
        if (!city || !street || !building) throw new Error(`Fill in the ${kind === "pickup" ? "pickup" : "delivery"} city, street and building first.`);
        const query = `${building} ${street}, ${city}, Kazakhstan`;
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=kz&q=${encodeURIComponent(query)}`;
        const response = await fetch(url, { headers: { "Accept":"application/json" } });
        if (!response.ok) throw new Error("Address search service is temporarily unavailable.");
        const results = await response.json();
        if (!results.length) throw new Error(`Could not find address: ${query}. Try a more precise street name.`);
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
        buildButton.textContent = "Building…";
        summary.textContent = "Finding both addresses and calculating route…";
        try {
            const pickup = await geocodeAddress("pickup");
            setPoint("pickup", pickup.lat, pickup.lon, pickup.label);
            await new Promise(resolve => setTimeout(resolve, 1100)); // respect Nominatim's public rate limit
            const delivery = await geocodeAddress("delivery");
            setPoint("delivery", delivery.lat, delivery.lon, delivery.label);

            const routeUrl = `https://router.project-osrm.org/route/v1/driving/${pickup.lon},${pickup.lat};${delivery.lon},${delivery.lat}?overview=full&geometries=geojson&steps=true`;
            const routeResponse = await fetch(routeUrl);
            if (!routeResponse.ok) throw new Error("Road routing service is unavailable.");
            const routeData = await routeResponse.json();
            if (routeData.code !== "Ok" || !routeData.routes?.length) throw new Error("No driving route was found for these addresses.");
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
                <span>Distance: ${distanceKm.toFixed(1)} km</span>
                <span>Road estimate: ${Math.ceil(baseMinutes)} min</span>
                <span>Weather: ${escapeText(weatherText)} · ${Math.round(weather.temperature_2m)}°C</span>
                <span>Weather-adjusted estimate: ${adjustedMinutes} min</span>`;
            note.textContent = `Weather adjustment is a transparent demo heuristic (${Math.round((factor - 1) * 100)}%); the route service does not provide live traffic. Weather is checked near the delivery address.`;
            fields("pickup_lat").dispatchEvent(new Event("change", { bubbles:true }));
        } catch (error) {
            summary.textContent = error.message || "Could not calculate route.";
            note.textContent = "Check the addresses and try again. You can also select approximate points directly on the map.";
        } finally {
            buildButton.disabled = false;
            buildButton.textContent = "Build route";
        }
    }

    buildButton.addEventListener("click", buildRoute);
    map.on("click", event => {
        const kind = nextMapPoint;
        setPoint(kind, event.latlng.lat, event.latlng.lng, "Map selection");
        nextMapPoint = kind === "pickup" ? "delivery" : "pickup";
        note.textContent = `Selected ${kind === "pickup" ? "pickup" : "delivery"} point. Next map click selects ${nextMapPoint === "pickup" ? "pickup" : "delivery"}. Click “Build route” after selecting both points.`;
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
