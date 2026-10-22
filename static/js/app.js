(() => {
  "use strict";

  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const state = { dashboard: null, charts: {}, trace: null, cursor: 0, timer: null, busy: false };
  const stateNames = {
    q0: "q₀", q1: "q₁", q2: "q₂", q3: "q₃", q4: "q₄", q5: "q₅",
    q6: "q₆", q7: "q₇", q8: "q₈", q9: "q₉", q10: "q₁₀", qDead: "q⊥",
  };
  const symbolNames = { LETTER: "LETTER", DIGIT: "DIGIT", OTHER: "OTHER" };
  const chartAccent = () => document.body.classList.contains("dark") ? "#58d9b6" : "#4d8be4";

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`The server returned an unreadable response (${response.status}).`);
    }
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
    return payload;
  }

  function refreshChartTheme() {
    Object.entries(state.charts).forEach(([name, chart]) => {
      if (name === "occupancy") {
        chart.data.datasets[0].backgroundColor = document.body.classList.contains("dark")
          ? ["#4cd3a6", "#4a6878"]
          : ["#42bb92", "#2b4665"];
        chart.data.datasets[0].hoverBackgroundColor = document.body.classList.contains("dark")
          ? ["#70e4bc", "#587a88"]
          : ["#36aa83", "#233b59"];
      } else {
        chart.data.datasets[0].borderColor = chartAccent();
        chart.data.datasets[0].pointBorderColor = chartAccent();
        chart.data.datasets[0].backgroundColor = (context) => {
          const gradient = context.chart.ctx.createLinearGradient(0, 0, 0, 175);
          const dark = document.body.classList.contains("dark");
          gradient.addColorStop(0, dark ? "rgba(72, 212, 178, .20)" : "rgba(77, 139, 228, .18)");
          gradient.addColorStop(1, dark ? "rgba(72, 212, 178, .005)" : "rgba(77, 139, 228, .005)");
          return gradient;
        };
        chart.options = { ...chart.options, ...chartOptions() };
      }
      chart.update("none");
    });
  }

  function notify(message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    $("#toast-region").append(toast);
    window.setTimeout(() => toast.remove(), 4200);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function localTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function setPage() {
    const pages = ["home", "dashboard", "validator", "simulator", "operations", "slots", "analytics", "testing"];
    const requested = location.hash.replace("#", "");
    const page = pages.includes(requested) ? requested : "home";
    $$(".page").forEach((item) => item.classList.toggle("active", item.id === `page-${page}`));
    $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.page === page));
    $("#breadcrumb-current").textContent = ({
      home: "Project home", dashboard: "Dashboard", validator: "Plate validator", simulator: "DFA simulator",
      operations: "Entry & exit", slots: "Parking slots", analytics: "Analytics", testing: "Test suite",
    })[page];
    $("#sidebar").classList.remove("open");
  }

  function chartOptions(percent = false) {
    const dark = document.body.classList.contains("dark");
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 450 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#142337",
          padding: 10,
          titleFont: { family: "DM Sans", size: 10 },
          bodyFont: { family: "DM Sans", size: 10 },
          displayColors: false,
        },
      },
      scales: percent ? undefined : {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: dark ? "#91a4a1" : "#94a1b0", font: { family: "DM Sans", size: 9 }, maxRotation: 0, autoSkip: true },
        },
        y: {
          beginAtZero: true,
          border: { display: false, dash: [3, 3] },
          grid: { color: dark ? "#293b40" : "#edf1f5", drawTicks: false },
          ticks: {
            color: dark ? "#829795" : "#9aa6b4", padding: 7, precision: 0,
            font: { family: "DM Sans", size: 8 },
            callback: (value) => Number.isInteger(value) ? value : "",
          },
        },
      },
    };
  }

  function makeLineChart(canvasId, labels, values) {
    if (!window.Chart) return;
    const canvas = $(`#${canvasId}`);
    if (!canvas) return;
    if (state.charts[canvasId]) {
      state.charts[canvasId].data.labels = labels;
      state.charts[canvasId].data.datasets[0].data = values;
      state.charts[canvasId].update();
      return;
    }
    state.charts[canvasId] = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: chartAccent(),
          backgroundColor: (context) => {
            const gradient = context.chart.ctx.createLinearGradient(0, 0, 0, 175);
            const dark = document.body.classList.contains("dark");
            gradient.addColorStop(0, dark ? "rgba(72, 212, 178, .20)" : "rgba(77, 139, 228, .18)");
            gradient.addColorStop(1, dark ? "rgba(72, 212, 178, .005)" : "rgba(77, 139, 228, .005)");
            return gradient;
          },
          fill: true,
          tension: .36,
          borderWidth: 2,
          pointRadius: values.map((value) => value ? 3 : 0),
          pointHoverRadius: 4,
          pointBackgroundColor: "#fff",
          pointBorderColor: chartAccent(),
          pointBorderWidth: 2,
        }],
      },
      options: chartOptions(),
    });
  }

  function renderDashboard(data) {
    state.dashboard = data;
    const stats = data.stats;
    $("#stat-total").textContent = stats.total_slots;
    $("#stat-available").textContent = stats.available_slots;
    $("#stat-occupied").textContent = stats.occupied_slots;
    $("#stat-today").textContent = stats.entries_today;
    $("#occupancy-label").textContent = `${stats.occupancy_percent}%`;
    $("#occupancy-center").textContent = stats.occupied_slots;
    $("#legend-available").textContent = stats.available_slots;
    $("#legend-occupied").textContent = stats.occupied_slots;
    $("#occupancy-bar-fill").style.width = `${stats.occupancy_percent}%`;
    $("#occupancy-caption").textContent = `${stats.occupied_slots} of ${stats.total_slots} spaces in use`;
    $("#full-banner").classList.toggle("hidden", !stats.is_full);
    $("#home-occupancy").textContent = stats.occupied_slots;
    $("#home-capacity").textContent = `${stats.total_slots} total spaces`;
    $("#home-available").textContent = `${stats.available_slots} available`;
    $("#home-occupancy-fill").style.width = `${stats.occupancy_percent}%`;
    $("#home-slot-preview").innerHTML = data.slots.slice(0, 24).map((slot) =>
      `<span class="preview-slot${slot.plate ? " occupied" : ""}" title="${escapeHtml(slot.code)}${slot.plate ? ` · ${escapeHtml(slot.plate)}` : " · available"}"></span>`,
    ).join("");

    if (window.Chart) {
      const canvas = $("#occupancy-chart");
      if (canvas) {
        if (!state.charts.occupancy) {
          state.charts.occupancy = new Chart(canvas, {
            type: "doughnut",
            data: {
              labels: ["Available", "Occupied"],
              datasets: [{
                data: [stats.available_slots, stats.occupied_slots],
                backgroundColor: ["#42bb92", "#2b4665"],
                hoverBackgroundColor: ["#36aa83", "#233b59"],
                borderWidth: 0,
                spacing: 3,
                borderRadius: 4,
              }],
            },
            options: {
              responsive: true, maintainAspectRatio: false, cutout: "79%",
              plugins: {
                legend: { display: false },
                tooltip: {
                  backgroundColor: "#142337", padding: 9, displayColors: true,
                  titleFont: { family: "DM Sans", size: 9 }, bodyFont: { family: "DM Sans", size: 9 },
                },
              },
            },
          });
        } else {
          state.charts.occupancy.data.datasets[0].data = [stats.available_slots, stats.occupied_slots];
          state.charts.occupancy.update();
        }
      }
    }

    const activity = $("#recent-activity");
    if (!data.recent_activity.length) {
      activity.innerHTML = '<div class="activity-empty">No vehicle activity yet. Approved arrivals will appear here.</div>';
    } else {
      activity.innerHTML = data.recent_activity.map((item) => {
        const arrival = !item.exited_at;
        return `<div class="activity-item"><span class="activity-symbol ${arrival ? "arrival" : "departure"}">${arrival ? "↙" : "↗"}</span><div class="activity-main"><strong>${escapeHtml(item.plate)}</strong><span>Space ${escapeHtml(item.slot)} · ${arrival ? "Arrival" : "Departure"}</span></div><span class="activity-time">${localTime(arrival ? item.entered_at : item.exited_at)}</span></div>`;
      }).join("");
    }
    const hourlyLabels = data.hourly.map(({ hour }) => `${String(hour).padStart(2, "0")}:00`);
    const hourlyCounts = data.hourly.map(({ count }) => count);
    makeLineChart("hourly-chart", hourlyLabels, hourlyCounts);
    makeLineChart("analytics-hourly-chart", hourlyLabels, hourlyCounts);
    makeLineChart(
      "daily-chart",
      data.daily.map(({ day }) => new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })),
      data.daily.map(({ count }) => count),
    );
    $("#analytics-occupancy").textContent = `${stats.occupancy_percent}%`;
    $("#analytics-today").textContent = stats.entries_today;
    $("#analytics-available").textContent = stats.available_slots;
    renderActiveVehicles(data.active_vehicles);
    renderSlots(data.slots);
  }

  function renderActiveVehicles(vehicles) {
    $("#active-count").textContent = `${vehicles.length} ${vehicles.length === 1 ? "VEHICLE" : "VEHICLES"}`;
    $("#active-empty").classList.toggle("hidden", vehicles.length > 0);
    $("#active-vehicles").innerHTML = vehicles.map((item) =>
      `<tr><td>${escapeHtml(item.plate)}</td><td>${escapeHtml(item.slot)}</td><td>${escapeHtml(new Date(item.entered_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</td><td><span class="table-status">Parked</span></td></tr>`,
    ).join("");
  }

  function renderSlots(slots) {
    const available = slots.filter((slot) => !slot.plate).length;
    $("#slot-available-label").textContent = `${available} available`;
    $("#slot-occupied-label").textContent = `${slots.length - available} occupied`;
    $("#slot-grid").innerHTML = slots.map((slot) => {
      const occupied = Boolean(slot.plate);
      return `<button class="parking-slot ${occupied ? "occupied" : ""}" type="button" data-plate="${occupied ? escapeHtml(slot.plate) : ""}" data-slot="${escapeHtml(slot.code)}" aria-label="${escapeHtml(slot.code)}, ${occupied ? `occupied by ${escapeHtml(slot.plate)}` : "available"}"><span class="slot-car">${occupied ? "▰" : "▱"}</span><span class="slot-code">${escapeHtml(slot.code)}</span>${occupied ? `<span class="slot-plate">${escapeHtml(slot.plate)}</span>` : ""}</button>`;
    }).join("");
  }

  async function refreshDashboard() {
    try {
      renderDashboard(await api("/api/dashboard"));
    } catch (error) {
      notify(`Could not load parking data: ${error.message}`, "error");
    }
  }

  async function validatePlate(plate) {
    return api("/api/validate", { method: "POST", body: JSON.stringify({ plate }) });
  }

  function renderValidationResult(result, target) {
    target.classList.remove("hidden", "result-valid", "result-invalid");
    target.classList.add(result.valid ? "result-valid" : "result-invalid");
    const failure = result.failure;
    const reason = result.valid
      ? `${escapeHtml(result.plate)} matches the simplified registration pattern. DFA ended in accepting state ${stateNames[result.final_state]}.`
      : `${escapeHtml(failure.reason)} Expected <code>LL DD L{1,2} DDDD</code>; for example <code>TS09AB1234</code>.`;
    const characters = [...result.plate].map((character, index) => {
      const invalid = !result.valid && failure && failure.position === index + 1;
      return `<span class="plate-char ${invalid ? "error-char" : ""}" title="${invalid ? "Unexpected character" : `Position ${index + 1}`}">${escapeHtml(character)}</span>`;
    }).join("");
    target.innerHTML = `<div class="result-title"><span>${result.valid ? "✓" : "×"}</span>${result.valid ? "Valid format" : "Invalid format"}</div><p class="result-copy">${reason}${failure && !failure.character && !result.valid ? ` Invalid or missing character at position ${failure.position}.` : ""}</p><div class="result-plate">${characters || '<span class="plate-char">∅</span>'}</div>`;
  }

  async function validateAndShow(input, target, plate) {
    const normalized = plate.toUpperCase();
    input.value = normalized;
    try {
      renderValidationResult(await validatePlate(normalized), target);
    } catch (error) {
      target.className = "result-box result-invalid";
      target.textContent = `Validation could not be completed: ${error.message}`;
    }
  }

  function stateLabel(stateName) {
    return stateNames[stateName] || stateName;
  }

  function makeSvgElement(name, attributes = {}) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  const positions = Object.fromEntries(
    Array.from({ length: 11 }, (_, index) => [`q${index}`, { x: 61 + index * 108, y: 111 }]),
  );
  positions.qDead = { x: 603, y: 245 };
  const graphEdges = [
    ["q0", "q1", "LETTER"], ["q1", "q2", "LETTER"],
    ["q2", "q3", "DIGIT"], ["q3", "q4", "DIGIT"],
    ["q4", "q5", "LETTER"], ["q5", "q6", "LETTER"],
    ["q5", "q7", "DIGIT", "branch"], ["q6", "q7", "DIGIT"],
    ["q7", "q8", "DIGIT"], ["q8", "q9", "DIGIT"],
    ["q9", "q10", "DIGIT"],
  ];

  function renderDiagram() {
    const svg = $("#dfa-diagram");
    svg.replaceChildren();
    const defs = makeSvgElement("defs");
    [["arrow-neutral", "#b8c5d2"], ["arrow-active", "#2ca87e"], ["arrow-rejected", "#d7565f"]]
      .forEach(([id, color]) => {
        const marker = makeSvgElement("marker", {
          id, viewBox: "0 0 10 10", refX: "8.5", refY: "5", markerWidth: "6",
          markerHeight: "6", orient: "auto-start-reverse",
        });
        marker.append(makeSvgElement("path", { d: "M 0 1 L 9 5 L 0 9 z", fill: color }));
        defs.append(marker);
      });
    svg.append(defs);

    const seenSteps = state.trace ? state.trace.steps.slice(0, state.cursor) : [];
    const currentState = seenSteps.length ? seenSteps[seenSteps.length - 1].to_state : "q0";
    const accepted = state.trace && state.trace.valid && state.cursor === state.trace.steps.length;
    const rejected = seenSteps.some((step) => step.to_state === "qDead");
    graphEdges.forEach(([from, to, symbolClass, kind]) => {
      const activeIndex = seenSteps.findIndex((step) => step.from_state === from && step.to_state === to);
      let d;
      let labelY = 94;
      if (kind === "branch") {
        const start = positions[from];
        const end = positions[to];
        d = `M ${start.x + 10} ${start.y - 8} C ${start.x + 46} 25, ${end.x - 46} 25, ${end.x - 10} ${end.y - 8}`;
        labelY = 34;
      } else {
        const start = positions[from];
        const end = positions[to];
        d = `M ${start.x + 11} ${start.y} L ${end.x - 11} ${end.y}`;
      }
      const edge = makeSvgElement("path", {
        d,
        class: `dfa-edge${activeIndex !== -1 ? (seenSteps[activeIndex].to_state === "qDead" ? " rejected" : " active") : ""}`,
        ...(activeIndex !== -1 ? { "data-active-step": String(activeIndex + 1) } : {}),
      });
      svg.append(edge);
      const label = makeSvgElement("text", {
        x: String((positions[from].x + positions[to].x) / 2),
        y: String(labelY),
        class: `dfa-edge-label${activeIndex !== -1 ? " active" : ""}`,
      });
      label.textContent = symbolClass === "LETTER" ? "A–Z" : "0–9";
      svg.append(label);
    });

    const deadStart = positions.qDead;
    const firstFail = seenSteps.find((step) => step.to_state === "qDead");
    const failFrom = firstFail ? positions[firstFail.from_state] : positions.q4;
    const deadEdge = makeSvgElement("path", {
      d: `M ${failFrom.x} ${failFrom.y + 11} C ${failFrom.x} 205, ${deadStart.x} 185, ${deadStart.x} ${deadStart.y - 12}`,
      class: `dfa-edge${firstFail ? " rejected" : ""}`,
    });
    svg.append(deadEdge);
    const otherLabel = makeSvgElement("text", {
      x: String((failFrom.x + deadStart.x) / 2),
      y: "194",
      class: `dfa-edge-label${firstFail ? " active" : ""}`,
    });
    otherLabel.textContent = firstFail
      ? `${symbolNames[firstFail.symbol_class]} · position ${firstFail.position}`
      : "unexpected symbol";
    svg.append(otherLabel);

    const deadLoop = makeSvgElement("path", {
      d: "M 613 233 C 658 199, 666 277, 615 257",
      class: `dfa-edge${currentState === "qDead" ? " rejected" : ""}`,
    });
    svg.append(deadLoop);
    const loopLabel = makeSvgElement("text", {
      x: "665", y: "242", class: `dfa-edge-label${currentState === "qDead" ? " active" : ""}`,
    });
    loopLabel.textContent = "Σ";
    svg.append(loopLabel);

    Object.entries(positions).forEach(([name, point]) => {
      const isCurrent = name === currentState;
      const isAccept = name === "q10";
      const isDead = name === "qDead";
      const group = makeSvgElement("g");
      if (isCurrent) group.append(makeSvgElement("circle", { cx: String(point.x), cy: String(point.y), r: "17", class: "dfa-current-halo" }));
      group.append(makeSvgElement("circle", {
        cx: String(point.x), cy: String(point.y), r: "11",
        class: `dfa-node${isCurrent ? " current" : ""}${isAccept ? " accepting" : ""}${isDead && currentState === name ? " dead" : ""}${rejected && isDead ? " rejected" : ""}`,
      }));
      if (isAccept) group.append(makeSvgElement("circle", { cx: String(point.x), cy: String(point.y), r: "7.2", fill: "none", stroke: isCurrent ? "#22986c" : "#38a77e", "stroke-width": "1.2" }));
      const text = makeSvgElement("text", {
        x: String(point.x), y: String(point.y + .4),
        class: `dfa-node-label${isCurrent ? " current" : ""}${isAccept ? " accepting" : ""}${isDead && currentState === name ? " dead" : ""}`,
      });
      text.textContent = stateLabel(name);
      group.append(text);
      svg.append(group);
      if (name === "q0") {
        const start = makeSvgElement("text", { x: "48", y: "82", class: "dfa-start", "text-anchor": "middle" });
        start.textContent = "START";
        svg.append(start);
        svg.append(makeSvgElement("path", { d: "M 42 111 L 48 111", class: "dfa-edge" }));
      }
      if (name === "q10") {
        const accept = makeSvgElement("text", { x: String(point.x), y: "142", class: "dfa-start", "text-anchor": "middle", fill: "#288c67" });
        accept.textContent = "ACCEPT";
        svg.append(accept);
      }
      if (isDead) {
        const label = makeSvgElement("text", { x: String(point.x), y: "274", class: "dfa-start", "text-anchor": "middle" });
        label.textContent = "DEAD / REJECT";
        svg.append(label);
      }
    });
  }

  function renderTrace() {
    const trace = state.trace;
    const steps = trace ? trace.steps : [];
    const cursor = state.cursor;
    const currentState = cursor > 0 ? steps[cursor - 1].to_state : "q0";
    const terminal = Boolean(trace && cursor === steps.length);
    const isAccepted = terminal && trace.valid;
    const isRejected = terminal && !trace.valid;

    $("#current-state-tag").textContent = `${stateLabel(currentState)} · ${currentState === "q0" ? "START" : currentState === "q10" && isAccepted ? "ACCEPT" : currentState === "qDead" ? "REJECT" : "ACTIVE"}`;
    $("#current-state-tag").className = `tag ${isAccepted ? "tag-green" : isRejected ? "tag-amber" : "tag-blue"}`;
    $("#trace-summary").textContent = trace ? `${trace.plate.length} input characters · ${cursor} transitions processed` : "Load a registration to begin.";
    $("#character-track").innerHTML = trace && trace.plate
      ? [...trace.plate].map((character, index) => {
        const invalidIndex = !trace.valid && trace.failure?.character && trace.failure.position === index + 1;
        const processed = index < cursor;
        const current = index === cursor && cursor < steps.length;
        const invalid = invalidIndex && processed;
        return `<span class="character-cell${processed ? " processed" : ""}${current ? " current" : ""}${invalid ? " invalid" : ""}" title="Position ${index + 1}">${escapeHtml(character)}</span>`;
      }).join("")
      : '<span class="empty-log">Enter a plate and load its DFA trace.</span>';
    $("#step-counter-label").textContent = `${cursor} / ${steps.length} transitions`;
    $("#trace-outcome").textContent = isAccepted ? "ACCEPT · q₁₀" : isRejected ? "REJECT · not in q₁₀" : steps.length ? `Current state ${stateLabel(currentState)}` : "Awaiting input";
    $("#trace-outcome").style.color = isAccepted ? "#21906b" : isRejected ? "#c24f57" : "";
    $("#step-progress-fill").style.width = `${steps.length ? (cursor / steps.length) * 100 : 0}%`;
    $("#step-back").disabled = state.busy || cursor === 0;
    $("#step-forward").disabled = state.busy || cursor >= steps.length;
    $("#step-play").disabled = state.busy || !steps.length;
    $("#step-play").textContent = state.timer ? "Ⅱ Pause" : cursor >= steps.length ? "▶ Replay" : "▶ Play";
    $("#log-count").textContent = `${steps.length} ${steps.length === 1 ? "STEP" : "STEPS"}`;

    const visible = steps.slice(0, cursor);
    $("#transition-log").innerHTML = visible.length
      ? visible.map((step, index) => `<tr class="${index === cursor - 1 ? "is-current" : ""}${step.to_state === "qDead" ? " is-dead" : ""}"><td>${step.position}</td><td>'${escapeHtml(step.character)}'</td><td>${symbolNames[step.symbol_class]}</td><td>${stateLabel(step.from_state)}</td><td>${stateLabel(step.to_state)}</td></tr>`).join("")
      : '<tr><td class="empty-log" colspan="5">No transitions processed yet.</td></tr>';
    renderDiagram();
  }

  function stopPlayback() {
    if (state.timer) window.clearInterval(state.timer);
    state.timer = null;
  }

  function advanceTrace() {
    if (!state.trace || state.cursor >= state.trace.steps.length) {
      stopPlayback();
      renderTrace();
      return;
    }
    state.cursor += 1;
    renderTrace();
    if (state.cursor >= state.trace.steps.length) stopPlayback();
  }

  async function loadTrace(plate) {
    stopPlayback();
    state.busy = true;
    renderTrace();
    try {
      state.trace = await validatePlate(plate);
      state.cursor = 0;
      renderTrace();
    } catch (error) {
      notify(`Could not load DFA trace: ${error.message}`, "error");
    } finally {
      state.busy = false;
      renderTrace();
    }
  }

  async function runTestCases() {
    const summary = $("#test-summary");
    const list = $("#test-case-list");
    summary.className = "test-summary";
    summary.innerHTML = '<span class="test-spinner"></span>Running DFA test cases…';
    try {
      const data = await api("/api/test-cases");
      summary.className = `test-summary ${data.all_passed ? "all-pass" : "has-failure"}`;
      summary.textContent = data.all_passed
        ? `✓ All ${data.cases.length} DFA acceptance tests passed.`
        : `${data.cases.filter((item) => item.passed).length} of ${data.cases.length} tests passed.`;
      list.innerHTML = data.cases.map((item) => `<div class="test-case"><span class="test-state ${item.passed ? "pass" : "fail"}">${item.passed ? "✓" : "×"}</span><code>${escapeHtml(item.plate)}</code><p>${escapeHtml(item.note)}</p><span class="test-result"><span class="tag ${item.passed ? item.valid ? "tag-green" : "tag-gray" : "tag-amber"}">${item.passed ? item.valid ? "ACCEPT" : "REJECT" : "MISMATCH"}</span></span></div>`).join("");
    } catch (error) {
      summary.className = "test-summary has-failure";
      summary.textContent = `Test cases could not be loaded: ${error.message}`;
    }
  }

  function showOperationMessage(element, message, success) {
    element.className = `operation-message ${success ? "success" : "error"}`;
    element.textContent = message;
  }

  function setupEvents() {
    window.addEventListener("hashchange", setPage);
    $("#menu-toggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
    document.addEventListener("click", (event) => {
      if (event.target.closest("#sidebar") || event.target.closest("#menu-toggle")) return;
      $("#sidebar").classList.remove("open");
    });
    $("#theme-toggle").addEventListener("click", () => {
      document.body.classList.toggle("dark");
      try {
        localStorage.setItem("parkwise-theme", document.body.classList.contains("dark") ? "dark" : "light");
      } catch {
        notify("Theme changed for this visit. Browser storage is unavailable.", "error");
      }
      syncThemeControl();
      refreshChartTheme();
    });

    $("#validator-input").addEventListener("input", (event) => {
      const start = event.target.selectionStart;
      const value = event.target.value.toUpperCase();
      if (event.target.value !== value) {
        event.target.value = value;
        event.target.setSelectionRange(start, start);
      }
    });
    $("#validator-form").addEventListener("submit", (event) => {
      event.preventDefault();
      validateAndShow($("#validator-input"), $("#validation-result"), $("#validator-input").value);
    });
    $("#validator-clear").addEventListener("click", () => {
      $("#validator-input").value = "";
      $("#validation-result").classList.add("hidden");
      $("#validator-input").focus();
    });
    $("#validator-example").addEventListener("click", () => {
      $("#validator-input").value = "TS09AB1234";
      validateAndShow($("#validator-input"), $("#validation-result"), "TS09AB1234");
    });
    $$(".quick-test").forEach((button) => button.addEventListener("click", () => {
      location.hash = "#validator";
      const plate = button.dataset.plate;
      $("#validator-input").value = plate;
      validateAndShow($("#validator-input"), $("#validation-result"), plate);
    }));

    $("#simulator-form").addEventListener("submit", (event) => {
      event.preventDefault();
      loadTrace($("#simulator-input").value);
    });
    $("#simulator-input").addEventListener("input", (event) => {
      const start = event.target.selectionStart;
      const value = event.target.value.toUpperCase();
      if (event.target.value !== value) {
        event.target.value = value;
        event.target.setSelectionRange(start, start);
      }
    });
    $("#simulator-example").addEventListener("click", () => {
      $("#simulator-input").value = "TS9AB123";
      loadTrace("TS9AB123");
    });
    $("#simulator-clear").addEventListener("click", () => {
      $("#simulator-input").value = "";
      stopPlayback();
      state.trace = null;
      state.cursor = 0;
      renderTrace();
      $("#simulator-input").focus();
    });
    $("#step-forward").addEventListener("click", advanceTrace);
    $("#step-back").addEventListener("click", () => {
      stopPlayback();
      state.cursor = Math.max(0, state.cursor - 1);
      renderTrace();
    });
    $("#step-reset").addEventListener("click", () => {
      stopPlayback();
      state.cursor = 0;
      renderTrace();
    });
    $("#step-play").addEventListener("click", () => {
      if (!state.trace || !state.trace.steps.length) return;
      if (state.timer) {
        stopPlayback();
        renderTrace();
        return;
      }
      if (state.cursor >= state.trace.steps.length) state.cursor = 0;
      renderTrace();
      state.timer = window.setInterval(advanceTrace, 550);
      renderTrace();
    });

    $("#entry-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = $("#entry-plate");
      const plate = input.value.toUpperCase();
      const message = $("#entry-message");
      if (!$("#operator-approved").checked) {
        message.classList.remove("hidden");
        showOperationMessage(message, "Operator approval is required before a parking entry can be created.", false);
        return;
      }
      const submit = $("#entry-submit");
      submit.disabled = true;
      try {
        const validation = await validatePlate(plate);
        if (!validation.valid) {
          message.classList.remove("hidden");
          showOperationMessage(message, `${validation.failure.reason} No parking entry was created.`, false);
          return;
        }
        const data = await api("/api/entries", {
          method: "POST",
          body: JSON.stringify({ plate, operator_approved: true }),
        });
        input.value = "";
        $("#operator-approved").checked = false;
        message.classList.remove("hidden");
        showOperationMessage(message, `${data.message} ${data.entry.plate} → space ${data.entry.slot}. Entry ${localTime(data.entry.entered_at)}.`, true);
        notify(`${data.entry.plate} assigned to ${data.entry.slot}.`);
        await refreshDashboard();
      } catch (error) {
        message.classList.remove("hidden");
        showOperationMessage(message, error.message, false);
      } finally {
        submit.disabled = false;
      }
    });
    $("#entry-plate").addEventListener("input", (event) => {
      event.target.value = event.target.value.toUpperCase();
    });
    $("#exit-plate").addEventListener("input", (event) => {
      event.target.value = event.target.value.toUpperCase();
    });
    $("#exit-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = $("#exit-plate");
      const message = $("#exit-message");
      try {
        const data = await api("/api/exits", {
          method: "POST",
          body: JSON.stringify({ plate: input.value }),
        });
        input.value = "";
        message.classList.remove("hidden");
        showOperationMessage(message, `${data.message} ${data.entry.plate} released ${data.entry.slot}.`, true);
        notify(`${data.entry.plate} departed; ${data.entry.slot} is now available.`);
        await refreshDashboard();
      } catch (error) {
        message.classList.remove("hidden");
        showOperationMessage(message, error.message, false);
      }
    });

    $("#slot-grid").addEventListener("click", (event) => {
      const slot = event.target.closest(".parking-slot");
      if (!slot || !slot.dataset.plate) return;
      location.hash = "#operations";
      $("#exit-plate").value = slot.dataset.plate;
      $("#exit-message").classList.add("hidden");
    });
    $("#rerun-tests").addEventListener("click", runTestCases);
  }

  function initialize() {
    try {
      const savedTheme = localStorage.getItem("parkwise-theme");
      if (savedTheme === "dark") document.body.classList.add("dark");
      if (savedTheme === "light") document.body.classList.remove("dark");
    } catch {
      // The theme toggle still works without persisted browser storage.
    }
    syncThemeControl();
    $("#today-label").textContent = new Intl.DateTimeFormat([], {
      weekday: "short", month: "short", day: "numeric",
    }).format(new Date());
    setupEvents();
    setPage();
    renderTrace();
    refreshDashboard();
    runTestCases();
    if (!location.hash) history.replaceState(null, "", "#home");
  }

  function syncThemeControl() {
    const isDark = document.body.classList.contains("dark");
    const label = isDark ? "Switch to light mode" : "Switch to dark mode";
    $("#theme-toggle").textContent = isDark ? "☼" : "◐";
    $("#theme-toggle").setAttribute("aria-label", label);
    $("#theme-toggle").title = label;
  }

  initialize();
})();
