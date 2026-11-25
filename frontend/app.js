/**
 * Projeto Integrador de Monitoramento IoT
 * Bloco 3: Painel Frontend Web (Cloudflare Pages)
 *
 * Requisitos atendidos:
 * - Consulta periódica à API REST via HTTPS (GET /functions/v1/telemetry)
 * - Exibe valor atual, unidade, horário da última atualização, histórico e condição de alerta
 * - Indica automaticamente quando os dados estão desatualizados (transmissão interrompida)
 * - Volta a exibir novas leituras automaticamente quando a transmissão é retomada
 * - Mantém URLs/chaves fora do código público (armazenadas em localStorage pelo usuário)
 */

const STORAGE_KEYS = {
  API_URL: "iot_monitor_api_url",
  API_KEY: "iot_monitor_api_key",
  STALE_SECONDS: "iot_monitor_stale_seconds",
};

const DEFAULT_API_URL = "https://tvpctlctyjzgdfzcxyus.supabase.co/functions/v1/telemetry";
const POLL_INTERVAL_MS = 3000; // Consulta a API a cada 3 segundos
const DEFAULT_STALE_SECONDS = 15; // Como o ESP32 envia a cada 5s, >15s sem nova leitura = dados desatualizados

let latestReadingCache = null;
let telemetryChart = null;

// Elementos de UI
const els = {
  transmissionBadge: document.getElementById("transmissionBadge"),
  transmissionText: document.getElementById("transmissionText"),
  btnToggleConfig: document.getElementById("btnToggleConfig"),
  configPanel: document.getElementById("configPanel"),
  configForm: document.getElementById("configForm"),
  apiUrlInput: document.getElementById("apiUrlInput"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  staleSecondsInput: document.getElementById("staleSecondsInput"),
  btnRefreshNow: document.getElementById("btnRefreshNow"),
  btnManualPoll: document.getElementById("btnManualPoll"),
  staleBanner: document.getElementById("staleBanner"),
  staleBannerDesc: document.getElementById("staleBannerDesc"),
  alertBanner: document.getElementById("alertBanner"),
  alertBannerDesc: document.getElementById("alertBannerDesc"),
  currentValue: document.getElementById("currentValue"),
  currentUnit: document.getElementById("currentUnit"),
  rawValue: document.getElementById("rawValue"),
  humidityValue: document.getElementById("humidityValue"),
  alertStatusBox: document.getElementById("alertStatusBox"),
  alertStatusTitle: document.getElementById("alertStatusTitle"),
  alertStatusRule: document.getElementById("alertStatusRule"),
  metricName: document.getElementById("metricName"),
  lastUpdateTime: document.getElementById("lastUpdateTime"),
  lastUpdateDate: document.getElementById("lastUpdateDate"),
  readingAge: document.getElementById("readingAge"),
  freshnessState: document.getElementById("freshnessState"),
  deviceIdText: document.getElementById("deviceIdText"),
  historyCount: document.getElementById("historyCount"),
  httpStatusBadge: document.getElementById("httpStatusBadge"),
  apiJsonPreview: document.getElementById("apiJsonPreview"),
  historyTableBody: document.getElementById("historyTableBody"),
};

function getConfig() {
  const params = new URLSearchParams(window.location.search);
  const queryApiUrl = params.get("api_url");
  if (queryApiUrl) {
    localStorage.setItem(STORAGE_KEYS.API_URL, queryApiUrl);
  }

  return {
    apiUrl: (localStorage.getItem(STORAGE_KEYS.API_URL) || DEFAULT_API_URL).trim(),
    apiKey: (localStorage.getItem(STORAGE_KEYS.API_KEY) || "").trim(),
    staleSeconds: Number(localStorage.getItem(STORAGE_KEYS.STALE_SECONDS)) || DEFAULT_STALE_SECONDS,
  };
}

function initChart() {
  const ctx = document.getElementById("telemetryChart").getContext("2d");
  telemetryChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Temperatura Tratada (°C)",
          data: [],
          borderColor: "#38bdf8",
          backgroundColor: "rgba(56, 189, 248, 0.15)",
          borderWidth: 2.5,
          tension: 0.25,
          fill: true,
        },
        {
          label: "Temperatura Bruta DHT22 (°C)",
          data: [],
          borderColor: "#94a3b8",
          borderDash: [4, 4],
          borderWidth: 1.5,
          tension: 0.2,
          fill: false,
        },
        {
          label: "Limite Térmico Crítico (30,0 °C)",
          data: [],
          borderColor: "#ef4444",
          borderDash: [6, 4],
          borderWidth: 1.8,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      plugins: {
        legend: {
          labels: { color: "#cbd5e1", font: { size: 12 } },
        },
      },
      scales: {
        x: {
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(51, 65, 85, 0.35)" },
        },
        y: {
          ticks: { color: "#94a3b8" },
          grid: { color: "rgba(51, 65, 85, 0.35)" },
        },
      },
    },
  });
}

/**
 * Verifica em tempo real (a cada 1 segundo) se a última leitura recebida está atualizada
 * ou desatualizada (quando a simulação no Wokwi é pausada/interrompida).
 */
function evaluateDataFreshness() {
  if (!latestReadingCache || !latestReadingCache.created_at) {
    return;
  }

  const { staleSeconds } = getConfig();
  const readingTimestamp = new Date(latestReadingCache.created_at).getTime();
  const ageSeconds = Math.max(0, Math.floor((Date.now() - readingTimestamp) / 1000));

  els.readingAge.textContent = `${ageSeconds}s atrás`;

  const isStale = ageSeconds > staleSeconds;

  if (isStale) {
    els.transmissionBadge.className = "status-pill status-stale";
    els.transmissionText.textContent = `Dados Desatualizados (${ageSeconds}s sem novas leituras)`;
    els.freshnessState.textContent = "DESATUALIZADO (Transmissão pausada)";
    els.freshnessState.style.color = "#fbbf24";
    els.staleBanner.classList.remove("hidden");
    els.staleBannerDesc.textContent =
      `A última leitura do dispositivo "${latestReadingCache.device_id}" ocorreu há ${ageSeconds} segundos ` +
      `(limite de atualização: ${staleSeconds}s). Retome a transmissão no Wokwi para receber novas leituras.`;
  } else {
    els.transmissionBadge.className = "status-pill status-online";
    els.transmissionText.textContent = "Transmissão Ativa (Dados Atualizados)";
    els.freshnessState.textContent = "ATUALIZADO (Em tempo real)";
    els.freshnessState.style.color = "#4ade80";
    els.staleBanner.classList.add("hidden");
  }
}

function renderDashboard(payload) {
  const latest = payload.latest;
  const history = Array.isArray(payload.history) ? payload.history : [];

  els.historyCount.textContent = String(history.length);

  if (!latest) {
    els.currentValue.textContent = "--";
    return;
  }

  latestReadingCache = latest;

  const valueNum = Number(latest.value);
  const rawNum = latest.raw_value !== null && latest.raw_value !== undefined ? Number(latest.raw_value) : valueNum;
  const thresholdNum = latest.threshold !== null && latest.threshold !== undefined ? Number(latest.threshold) : 30.0;
  const unit = latest.unit || "°C";
  const isAlert = Boolean(latest.alert) || valueNum > thresholdNum;

  // 1. Valor atual e unidade
  els.currentValue.textContent = valueNum.toFixed(2);
  els.currentUnit.textContent = unit;
  els.rawValue.textContent = `${rawNum.toFixed(2)} ${unit}`;
  els.humidityValue.textContent =
    latest.humidity !== null && latest.humidity !== undefined ? `${Number(latest.humidity).toFixed(1)} %` : "--";

  // 2. Identificação do dispositivo e da grandeza medida
  els.deviceIdText.textContent = latest.device_id || "esp32-rack-ia-01";
  els.metricName.textContent = latest.metric || "temperatura_rack_gpu";

  // 3. Horário da última atualização
  const createdDate = new Date(latest.created_at);
  els.lastUpdateTime.textContent = createdDate.toLocaleTimeString("pt-BR");
  els.lastUpdateDate.textContent = createdDate.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  // 4. Condição de alerta
  els.alertStatusRule.textContent = `Limite configurado: > ${thresholdNum.toFixed(2)} ${unit}`;
  if (isAlert) {
    els.alertStatusBox.className = "alert-box alert-box-danger";
    els.alertStatusTitle.textContent = "🚨 ALERTA: ACIMA DO LIMITE";
    els.alertBanner.classList.remove("hidden");
    els.alertBannerDesc.textContent =
      `Leitura atual de ${valueNum.toFixed(2)} ${unit} no dispositivo ${latest.device_id} ` +
      `ultrapassou o limite máximo de ${thresholdNum.toFixed(2)} ${unit}!`;
  } else {
    els.alertStatusBox.className = "alert-box alert-box-normal";
    els.alertStatusTitle.textContent = "✅ NORMAL (DENTRO DA FAIXA)";
    els.alertBanner.classList.add("hidden");
  }

  // 5. Verifica se os dados estão atualizados ou desatualizados
  evaluateDataFreshness();

  // 6. Atualiza Gráfico de Histórico (ordem cronológica da esquerda para a direita)
  const chronological = [...history].reverse();
  telemetryChart.data.labels = chronological.map((item) =>
    new Date(item.created_at).toLocaleTimeString("pt-BR")
  );
  telemetryChart.data.datasets[0].data = chronological.map((item) => Number(item.value));
  telemetryChart.data.datasets[1].data = chronological.map((item) =>
    item.raw_value !== null && item.raw_value !== undefined ? Number(item.raw_value) : Number(item.value)
  );
  telemetryChart.data.datasets[2].data = chronological.map((item) =>
    item.threshold !== null && item.threshold !== undefined ? Number(item.threshold) : 30.0
  );
  telemetryChart.update();

  // 7. Atualiza Tabela de Histórico
  if (history.length === 0) {
    els.historyTableBody.innerHTML =
      '<tr><td colspan="9" class="empty-row">Nenhuma leitura encontrada no banco de dados.</td></tr>';
  } else {
    els.historyTableBody.innerHTML = history
      .map((row) => {
        const dt = new Date(row.created_at).toLocaleString("pt-BR");
        const val = Number(row.value).toFixed(2);
        const raw = row.raw_value !== null && row.raw_value !== undefined ? Number(row.raw_value).toFixed(2) : val;
        const hum = row.humidity !== null && row.humidity !== undefined ? `${Number(row.humidity).toFixed(1)}%` : "--";
        const rowAlert = Boolean(row.alert);
        return `
          <tr>
            <td>#${row.id ?? "--"}</td>
            <td>${dt}</td>
            <td><code>${row.device_id}</code></td>
            <td>${row.metric}</td>
            <td><strong>${val}</strong></td>
            <td>${raw}</td>
            <td>${hum}</td>
            <td>${row.unit || "°C"}</td>
            <td>
              <span class="tag ${rowAlert ? "tag-alert" : "tag-normal"}">
                ${rowAlert ? "ALERTA" : "NORMAL"}
              </span>
            </td>
          </tr>
        `;
      })
      .join("");
  }
}

async function fetchTelemetryFromApi() {
  const { apiUrl, apiKey } = getConfig();

  if (!apiUrl) {
    els.configPanel.classList.remove("hidden");
    return;
  }

  try {
    const headers = { Accept: "application/json" };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
      headers["apikey"] = apiKey;
    }

    const response = await fetch(`${apiUrl}?limit=25`, {
      method: "GET",
      headers,
    });

    els.httpStatusBadge.textContent = `HTTP ${response.status}`;
    const data = await response.json();
    els.apiJsonPreview.textContent = JSON.stringify(data, null, 2);

    if (response.ok && data) {
      renderDashboard(data);
    }
  } catch (error) {
    els.httpStatusBadge.textContent = "ERRO DE REDE";
    els.apiJsonPreview.textContent = `Falha ao consultar a API REST:\n${error.message}`;
  }
}

function setupEvents() {
  const cfg = getConfig();
  els.apiUrlInput.value = cfg.apiUrl;
  els.apiKeyInput.value = cfg.apiKey;
  els.staleSecondsInput.value = cfg.staleSeconds;

  if (!cfg.apiUrl) {
    els.configPanel.classList.remove("hidden");
  }

  els.btnToggleConfig.addEventListener("click", () => {
    els.configPanel.classList.toggle("hidden");
  });

  els.configForm.addEventListener("submit", (e) => {
    e.preventDefault();
    localStorage.setItem(STORAGE_KEYS.API_URL, els.apiUrlInput.value.trim());
    localStorage.setItem(STORAGE_KEYS.API_KEY, els.apiKeyInput.value.trim());
    localStorage.setItem(STORAGE_KEYS.STALE_SECONDS, els.staleSecondsInput.value.trim());
    els.configPanel.classList.add("hidden");
    fetchTelemetryFromApi();
  });

  els.btnRefreshNow.addEventListener("click", fetchTelemetryFromApi);
  els.btnManualPoll.addEventListener("click", fetchTelemetryFromApi);
}

document.addEventListener("DOMContentLoaded", () => {
  initChart();
  setupEvents();
  fetchTelemetryFromApi();

  // Polling periódico à API REST
  setInterval(fetchTelemetryFromApi, POLL_INTERVAL_MS);

  // Verificação contínua de dados desatualizados (a cada 1 segundo)
  setInterval(evaluateDataFreshness, 1000);
});
