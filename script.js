"use strict";

// ======================================================
// 1. STUDY AREA AND MAP CONFIGURATION
// ======================================================

const STUDY_AREA = {
  south: 33.35,
  west: 72.75,
  north: 33.95,
  east: 73.45
};

const MAP_CENTER = [33.6844, 73.0479];

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

// ======================================================
// 2. INITIALIZE THE LEAFLET MAP
// ======================================================

const map = L.map("map", {
  zoomControl: true
}).setView(MAP_CENTER, 11);

L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" ' +
      'target="_blank" rel="noopener">OpenStreetMap contributors</a>'
  }
).addTo(map);

// Keep healthcare markers in a separate layer.
const healthcareLayer = L.featureGroup().addTo(map);

// ======================================================
// 2A. HEALTHCARE MAP LEGEND
// ======================================================

const legend = L.control({
  position: "bottomleft"
});

legend.onAdd = function () {
  const div = L.DomUtil.create("div", "healthcare-legend");

  div.innerHTML = `
    <div class="legend-title">Healthcare Map Legend</div>

    <div class="legend-item">
      <span class="legend-symbol legend-hospital">H</span>
      <span>Hospitals</span>
    </div>

    <div class="legend-item">
      <span class="legend-symbol legend-clinic">C</span>
      <span>Clinics</span>
    </div>

    <div class="legend-item">
      <span class="legend-symbol legend-pharmacy">P</span>
      <span>Pharmacies</span>
    </div>

    <div class="legend-item">
      <span class="legend-symbol legend-doctors">D</span>
      <span>Doctors</span>
    </div>

    <div class="legend-item">
      <span class="legend-symbol legend-dentist">T</span>
      <span>Dental Facilities</span>
    </div>

    <div class="legend-item">
      <span class="legend-symbol legend-other">+</span>
      <span>Other Healthcare Facilities</span>
    </div>
  `;

  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);

  return div;
};

legend.addTo(map);

// ======================================================
// 3. HTML ELEMENT REFERENCES
// ======================================================

const searchInput = document.getElementById("searchInput");
const clearSearch = document.getElementById("clearSearch");
const categoryFilter = document.getElementById("categoryFilter");
const facilityList = document.getElementById("facilityList");
const totalCount = document.getElementById("totalCount");
const visibleCount = document.getElementById("visibleCount");
const categoryCount = document.getElementById("categoryCount");
const resultBadge = document.getElementById("resultBadge");
const statusMessage = document.getElementById("statusMessage");
const resetButton = document.getElementById("resetButton");
const refreshButton = document.getElementById("refreshButton");

// ======================================================
// 4. APPLICATION DATA
// ======================================================

let allFacilities = [];
let visibleFacilities = [];
let requestInProgress = false;

const CATEGORY_DETAILS = {
  hospital: {
    label: "Hospital",
    symbol: "H",
    markerClass: "marker-hospital"
  },
  clinic: {
    label: "Clinic",
    symbol: "C",
    markerClass: "marker-clinic"
  },
  pharmacy: {
    label: "Pharmacy",
    symbol: "P",
    markerClass: "marker-pharmacy"
  },
  doctors: {
    label: "Doctor",
    symbol: "D",
    markerClass: "marker-doctors"
  },
  dentist: {
    label: "Dental facility",
    symbol: "T",
    markerClass: "marker-dentist"
  },
  other: {
    label: "Healthcare facility",
    symbol: "+",
    markerClass: "marker-other"
  }
};

// ======================================================
// 5. CREATE THE OVERPASS API QUERY
// ======================================================

function createOverpassQuery() {
  const { south, west, north, east } = STUDY_AREA;

  const amenityTypes =
    "hospital|clinic|pharmacy|doctors|dentist";

  const healthcareTypes =
    "hospital|clinic|pharmacy|doctor|dentist";

  return `
    [out:json][timeout:45];

    (
      node["amenity"~"^(${amenityTypes})$"]
        (${south},${west},${north},${east});

      way["amenity"~"^(${amenityTypes})$"]
        (${south},${west},${north},${east});

      relation["amenity"~"^(${amenityTypes})$"]
        (${south},${west},${north},${east});

      node["healthcare"~"^(${healthcareTypes})$"]
        (${south},${west},${north},${east});

      way["healthcare"~"^(${healthcareTypes})$"]
        (${south},${west},${north},${east});

      relation["healthcare"~"^(${healthcareTypes})$"]
        (${south},${west},${north},${east});
    );

    out center tags;
  `;
}

// ======================================================
// 6. FETCH DATA FROM THE API
// ======================================================

async function fetchHealthcareData() {
  if (requestInProgress) return;

  requestInProgress = true;
  refreshButton.disabled = true;
  refreshButton.textContent = "Loading...";

  statusMessage.className = "status-message";
  statusMessage.textContent =
    "Fetching healthcare facilities from OpenStreetMap...";

  facilityList.innerHTML = `
    <div class="empty-state">
      <span class="loading-spinner"></span>
      <p>Retrieving healthcare data from the API...</p>
    </div>
  `;

  const query = createOverpassQuery();
  let successfulData = null;
  let lastError = null;

  try {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const controller = new AbortController();

        // Safety timeout for an unresponsive API endpoint.
        const timeoutId = setTimeout(
          () => controller.abort(),
          55000
        );

        let response;

        try {
          response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded;charset=UTF-8"
            },
            body: "data=" + encodeURIComponent(query),
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }

        if (!response.ok) {
          throw new Error(
            `API returned HTTP ${response.status}`
          );
        }

        const data = await response.json();

        if (!Array.isArray(data.elements)) {
          throw new Error("The API response has no elements array.");
        }

        successfulData = data;
        break;

      } catch (error) {
        lastError = error;
        console.warn("Overpass endpoint failed:", endpoint, error);
      }
    }

    if (!successfulData) {
      throw lastError || new Error("All API endpoints failed.");
    }

    // Convert the API response into usable facility records.
    allFacilities = successfulData.elements
      .map(normalizeFacility)
      .filter(Boolean);

    // Sort alphabetically for the directory.
    allFacilities.sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    totalCount.textContent = allFacilities.length;
    categoryCount.textContent =
      new Set(allFacilities.map(item => item.category)).size;

    renderFacilities();

    if (allFacilities.length > 0) {
      statusMessage.className = "status-message success";
      statusMessage.textContent =
        `Successfully loaded ${allFacilities.length} healthcare ` +
        "facilities from the Overpass API.";
    } else {
      statusMessage.className = "status-message";
      statusMessage.textContent =
        "The API responded, but no matching facilities with " +
        "usable coordinates were found in the study area.";
    }

  } catch (error) {
    console.error("Healthcare data error:", error);

    // Preserve any earlier data if a refresh fails.
    statusMessage.className = "status-message error";

    statusMessage.textContent =
      "Unable to retrieve healthcare data. The API may be busy, " +
      "your internet connection may be unavailable, or the " +
      "request may have timed out. Please try Refresh data again.";

    facilityList.innerHTML = `
      <div class="empty-state">
        <strong>Data could not be loaded</strong>
        <p>Check your internet connection and try again.</p>
      </div>
    `;

    // Restore the directory if older data is available.
    if (allFacilities.length > 0) {
      renderFacilities();
    }

  } finally {
    requestInProgress = false;
    refreshButton.disabled = false;
    refreshButton.textContent = "↻ Refresh data";
  }
}

// ======================================================
// 7. NORMALIZE API FEATURES
// ======================================================

function normalizeFacility(element) {
  const tags = element.tags || {};

  // Nodes contain lat/lon directly.
  // Ways and relations use the center returned by Overpass.
  const latitude = Number(
    element.lat ?? element.center?.lat
  );

  const longitude = Number(
    element.lon ?? element.center?.lon
  );

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }

  if (
    latitude < STUDY_AREA.south ||
    latitude > STUDY_AREA.north ||
    longitude < STUDY_AREA.west ||
    longitude > STUDY_AREA.east
  ) {
    return null;
  }

  const category = determineCategory(tags);

  const addressParts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:suburb"] || tags["addr:neighbourhood"],
    tags["addr:city"]
  ].filter(Boolean);

  const address = addressParts.length
    ? [...new Set(addressParts)].join(", ")
    : "Address not available in OpenStreetMap";

  return {
    id: `${element.type}-${element.id}`,
    name: tags.name || tags["name:en"] ||
      `${CATEGORY_DETAILS[category].label} (unnamed)`,
    category,
    latitude,
    longitude,
    address,
    phone: tags.phone || tags["contact:phone"] || "",
    website: tags.website || tags["contact:website"] || "",
    openingHours: tags.opening_hours || "",
    operator: tags.operator || "",
    emergency: tags.emergency || "",
    tags,
    marker: null
  };
}

// ======================================================
// 8. DETERMINE THE HEALTHCARE CATEGORY
// ======================================================

function determineCategory(tags) {
  const amenity = (tags.amenity || "").toLowerCase();
  const healthcare = (tags.healthcare || "").toLowerCase();

  if (amenity === "hospital" || healthcare === "hospital") {
    return "hospital";
  }

  if (amenity === "clinic" || healthcare === "clinic") {
    return "clinic";
  }

  if (amenity === "pharmacy" || healthcare === "pharmacy") {
    return "pharmacy";
  }

  if (
    amenity === "doctors" ||
    healthcare === "doctor" ||
    healthcare === "doctors"
  ) {
    return "doctors";
  }

  if (
    amenity === "dentist" ||
    healthcare === "dentist"
  ) {
    return "dentist";
  }

  return "other";
}

// ======================================================
// 9. CREATE MAP MARKERS
// ======================================================

function createMarker(facility) {
  const details =
    CATEGORY_DETAILS[facility.category] ||
    CATEGORY_DETAILS.other;

  const icon = L.divIcon({
    className: "",
    html:
      `<div class="map-marker ${details.markerClass}">` +
      `<span>${details.symbol}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -29]
  });

  const marker = L.marker(
    [facility.latitude, facility.longitude],
    {
      icon,
      title: facility.name,
      alt: facility.name
    }
  );

  marker.bindPopup(createPopupContent(facility));

  marker.on("click", () => {
    marker.openPopup();
  });

  facility.marker = marker;

  return marker;
}

// ======================================================
// 10. CREATE FACILITY INFORMATION POPUPS
// ======================================================

// Escape text before inserting API values into HTML.
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

// Accept only normal web URLs.
function safeWebURL(value) {
  try {
    const url = new URL(value);

    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
  } catch (error) {
    return "";
  }

  return "";
}

function popupRow(label, value) {
  if (!value) return "";

  return `
    <div class="popup-row">
      <strong>${escapeHTML(label)}:</strong>
      ${escapeHTML(value)}
    </div>
  `;
}

function createPopupContent(facility) {
  const details =
    CATEGORY_DETAILS[facility.category] ||
    CATEGORY_DETAILS.other;

  const websiteURL = safeWebURL(facility.website);

  const websiteHTML = websiteURL
    ? `<div class="popup-row">
         <strong>Website:</strong>
         <a class="popup-link"
            href="${escapeHTML(websiteURL)}"
            target="_blank"
            rel="noopener noreferrer">Visit website</a>
       </div>`
    : "";

  return `
    <div class="facility-popup">
      <h3 class="popup-title">
        ${escapeHTML(facility.name)}
      </h3>

      ${popupRow("Category", details.label)}
      ${popupRow("Address", facility.address)}
      ${popupRow("Telephone", facility.phone)}
      ${websiteHTML}
      ${popupRow("Opening hours", facility.openingHours)}
      ${popupRow("Operator", facility.operator)}
      ${popupRow("Emergency information", facility.emergency)}

      <div class="popup-row">
        <strong>Coordinates:</strong>
        ${facility.latitude.toFixed(5)},
        ${facility.longitude.toFixed(5)}
      </div>

      <div class="popup-row">
        <strong>OSM feature:</strong>
        ${escapeHTML(facility.id)}
      </div>
    </div>
  `;
}

// ======================================================
// 11. SEARCH AND CATEGORY FILTERING
// ======================================================

function getFilteredFacilities() {
  const searchTerm = searchInput.value
    .trim()
    .toLowerCase();

  const selectedCategory = categoryFilter.value;

  return allFacilities.filter(facility => {
    const matchesCategory =
      selectedCategory === "all" ||
      facility.category === selectedCategory;

    const searchableText = [
      facility.name,
      facility.category,
      facility.address,
      facility.phone,
      facility.operator,
      facility.website,
      facility.openingHours,
      ...Object.values(facility.tags)
    ].join(" ").toLowerCase();

    const matchesSearch =
      !searchTerm || searchableText.includes(searchTerm);

    return matchesCategory && matchesSearch;
  });
}

// ======================================================
// 12. RENDER MAP AND DIRECTORY
// ======================================================

function renderFacilities() {
  visibleFacilities = getFilteredFacilities();

  healthcareLayer.clearLayers();

  const listHTML = [];

  visibleFacilities.forEach(facility => {
    const details =
      CATEGORY_DETAILS[facility.category] ||
      CATEGORY_DETAILS.other;

    const marker = facility.marker || createMarker(facility);

    healthcareLayer.addLayer(marker);

    listHTML.push(`
      <button
        class="facility-item"
        type="button"
        data-facility-id="${escapeHTML(facility.id)}"
        aria-label="Show ${escapeHTML(facility.name)} on the map">

        <span class="facility-symbol">
          ${details.symbol}
        </span>

        <span class="facility-details">
          <span class="facility-name">
            ${escapeHTML(facility.name)}
          </span>

          <span class="facility-type">
            ${escapeHTML(details.label)}
          </span>

          <span class="facility-address">
            ${escapeHTML(facility.address)}
          </span>
        </span>
      </button>
    `);
  });

  facilityList.innerHTML = listHTML.length
    ? listHTML.join("")
    : `
      <div class="empty-state">
        <strong>No facilities found</strong>
        <p>Try a different search term or category.</p>
      </div>
    `;

  totalCount.textContent = allFacilities.length;
  visibleCount.textContent = visibleFacilities.length;
  resultBadge.textContent =
    `${visibleFacilities.length} result` +
    (visibleFacilities.length === 1 ? "" : "s");

  // Zoom to matching facilities when filters are applied.
  if (visibleFacilities.length > 0) {
    const bounds = healthcareLayer.getBounds();

    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [30, 30],
        maxZoom: 14
      });
    }
  }
}

// ======================================================
// 13. CLICK A DIRECTORY ITEM TO OPEN ITS MAP POPUP
// ======================================================

facilityList.addEventListener("click", event => {
  const item = event.target.closest("[data-facility-id]");

  if (!item) return;

  const facility = visibleFacilities.find(
    record => record.id === item.dataset.facilityId
  );

  if (!facility || !facility.marker) return;

  map.flyTo(
    [facility.latitude, facility.longitude],
    Math.max(map.getZoom(), 15),
    { duration: 0.6 }
  );

  facility.marker.openPopup();
});

// ======================================================
// 14. CONNECT THE USER INTERFACE CONTROLS
// ======================================================

searchInput.addEventListener("input", renderFacilities);

categoryFilter.addEventListener("change", renderFacilities);

clearSearch.addEventListener("click", () => {
  searchInput.value = "";
  searchInput.focus();
  renderFacilities();
});

resetButton.addEventListener("click", () => {
  searchInput.value = "";
  categoryFilter.value = "all";

  renderFacilities();

  map.setView(MAP_CENTER, 11);
});

refreshButton.addEventListener("click", fetchHealthcareData);

// ======================================================
// 15. START THE APPLICATION
// ======================================================

fetchHealthcareData();