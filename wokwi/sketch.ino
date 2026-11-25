/**
 * Projeto Integrador de Monitoramento IoT — AI Data Center Thermal Monitor
 * Bloco 1: Sensor Simulado no Wokwi (ESP32 + DHT22 + LED de Alerta)
 *
 * Tema: Monitoramento Térmico de Rack de GPUs em Data Center de IA
 * Arquitetura: Opção B — Envio direto por HTTPS para Supabase Edge Function (API REST)
 *
 * Conceitos de Arquitetura de Computadores aplicados:
 * 1. Entrada/Saída (I/O): Comunicação digital single-wire via registrador GPIO 15 com o sensor DHT22
 *    e saída digital via GPIO 2 para acionamento de atuador visual (LED de alerta térmico).
 * 2. Processamento (CPU/FPU): Validação de integridade (NaN), filtro de média móvel em memória SRAM
 *    (buffer circular de 3 amostras) e comparação lógica com limiar de Thermal Throttling (30.0 °C)
 *    na ULA/FPU do processador Xtensa Dual-Core LX6.
 * 3. Comunicação em Rede: Empacotamento JSON em buffer de memória e transmissão via pilha TCP/IP + TLS (HTTPS)
 *    com reuso de sessão Keep-Alive para reduzir handshakes TLS no gateway.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <DHT.h>

// ==================== CONFIGURAÇÕES DE REDE (WOKWI) ====================
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASSWORD = "";

// ==================== CONFIGURAÇÃO DA API REST (HTTPS) ====================
// Endpoint da Supabase Edge Function do projeto iot-datacenter-ia
const char* API_URL = "https://tvpctlctyjzgdfzcxyus.supabase.co/functions/v1/telemetry";

// Chave opcional (mantida fora do repositório público caso JWT seja ativado)
const char* API_BEARER_TOKEN = "";

// Identificação do dispositivo e parâmetros do Data Center de IA
const char* DEVICE_ID = "esp32-rack-ia-01";
const char* METRIC_NAME = "temperatura_rack_gpu";
const char* METRIC_UNIT = "°C";

// ==================== HARDWARE E PINOS (GPIO) ====================
#define DHTPIN 15       // Pino GPIO 15 conectado ao pino SDA/DATA do DHT22
#define DHTTYPE DHT22   // Modelo do sensor
#define ALERT_LED_PIN 2 // LED de alerta de superaquecimento do Rack (GPIO 2)

DHT dht(DHTPIN, DHTTYPE);
WiFiClientSecure secureClient;
HTTPClient https;

// ==================== PARÂMETROS DE MONITORAMENTO ====================
const unsigned long COLLECTION_INTERVAL_MS = 5000; // Intervalo de coleta: 5 segundos
const float TEMP_ALERT_THRESHOLD = 30.0;           // Alerta se temperatura > 30.0 °C (Risco de Thermal Throttling nas GPUs)
const float TEMP_MIN_VALID = -40.0;                // Limite físico inferior do DHT22
const float TEMP_MAX_VALID = 80.0;                 // Limite físico superior do DHT22

// ==================== BUFFER EM MEMÓRIA SRAM (MÉDIA MÓVEL) ====================
const int WINDOW_SIZE = 3;
float tempBuffer[WINDOW_SIZE];
int bufferIndex = 0;
int validSamplesCount = 0;
unsigned long lastCollectionTime = 0;

/**
 * Calcula a média móvel das últimas N leituras armazenadas na SRAM do ESP32.
 * Esse tratamento atenua flutuações rápidas de fluxo de ar nos corredores do Data Center.
 */
float computeMovingAverage(float newSample) {
  tempBuffer[bufferIndex] = newSample;
  bufferIndex = (bufferIndex + 1) % WINDOW_SIZE;
  if (validSamplesCount < WINDOW_SIZE) {
    validSamplesCount++;
  }

  float sum = 0.0;
  for (int i = 0; i < validSamplesCount; i++) {
    sum += tempBuffer[i];
  }
  return sum / validSamplesCount;
}

void connectWiFi() {
  Serial.print("[WIFI] Conectando a ");
  Serial.println(WIFI_SSID);
  WiFi.disconnect(true);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, 6);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(400);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Conectado com sucesso!");
    Serial.print("[WIFI] Endereco IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WIFI] Tentando reconectar no proximo ciclo...");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(ALERT_LED_PIN, OUTPUT);
  digitalWrite(ALERT_LED_PIN, LOW);

  dht.begin();
  secureClient.setInsecure(); // Permite TLS no simulador Wokwi sem bundle de CA raiz na Flash
  https.setReuse(true);       // Reutiliza conexão TCP/TLS (Keep-Alive) evitando bloqueio no gateway Wokwi

  Serial.println("==========================================================");
  Serial.println("  AI Data Center IoT — Monitoramento Termico de Rack GPU");
  Serial.println("  Dispositivo: esp32-rack-ia-01 | Sensor: DHT22 (GPIO 15)");
  Serial.println("==========================================================");

  connectWiFi();
}

void loop() {
  unsigned long currentMillis = millis();

  // Controle de temporização não-bloqueante baseado no registrador de ticks (millis)
  if (currentMillis - lastCollectionTime < COLLECTION_INTERVAL_MS) {
    return;
  }
  lastCollectionTime = currentMillis;

  // 1. Coleta das grandezas físicas via barramento digital GPIO 15
  float rawTemp = dht.readTemperature();
  float rawHumidity = dht.readHumidity();

  // 2. Tratamento 1: Validação de integridade e faixa física do sensor
  if (isnan(rawTemp) || isnan(rawHumidity) || rawTemp < TEMP_MIN_VALID || rawTemp > TEMP_MAX_VALID) {
    Serial.println("[ERRO] Falha na leitura do sensor DHT22 (dado invalido ou fora de faixa)!");
    return;
  }

  // 3. Tratamento 2: Filtro de Média Móvel (suavização na CPU/FPU)
  float processedTemp = computeMovingAverage(rawTemp);

  // 4. Tratamento 3: Comparação com limite crítico do Data Center (30.0 °C)
  bool isAlert = (processedTemp > TEMP_ALERT_THRESHOLD);
  digitalWrite(ALERT_LED_PIN, isAlert ? HIGH : LOW);

  // Log detalhado no Monitor Serial para demonstração no vídeo
  Serial.println("----------------------------------------------------------");
  Serial.printf("[SENSOR RACK IA] Temp Bruta: %.2f °C | Temp Media (Tratada): %.2f °C | Umidade: %.1f %%\n",
                rawTemp, processedTemp, rawHumidity);
  Serial.printf("[STATUS TERMICO] Limite: %.2f °C | Condicao: %s\n",
                TEMP_ALERT_THRESHOLD, isAlert ? "ALERTA CRITICO (SUPERAQUECIMENTO / THERMAL THROTTLING!)" : "NORMAL (OPERACAO SEGURA)");

  // 5. Envio via HTTPS POST para a API REST
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // Montagem do payload JSON com identificação do dispositivo e grandeza medida
  char payload[320];
  snprintf(
    payload,
    sizeof(payload),
    "{\"device_id\":\"%s\",\"metric\":\"%s\",\"value\":%.2f,\"raw_value\":%.2f,\"humidity\":%.1f,\"unit\":\"%s\",\"threshold\":%.2f,\"alert\":%s}",
    DEVICE_ID,
    METRIC_NAME,
    processedTemp,
    rawTemp,
    rawHumidity,
    METRIC_UNIT,
    TEMP_ALERT_THRESHOLD,
    isAlert ? "true" : "false"
  );

  Serial.print("[HTTPS POST] Payload enviado: ");
  Serial.println(payload);

  if (https.begin(secureClient, API_URL)) {
    https.setTimeout(8000);
    https.addHeader("Content-Type", "application/json");
    https.addHeader("Connection", "keep-alive");
    if (strlen(API_BEARER_TOKEN) > 0) {
      String authHeader = String("Bearer ") + API_BEARER_TOKEN;
      https.addHeader("Authorization", authHeader);
      https.addHeader("apikey", API_BEARER_TOKEN);
    }

    int httpResponseCode = https.POST(payload);

    // Se o gateway Wokwi fechar o socket antigo, reconecta o cliente TLS uma vez imediatamente
    if (httpResponseCode < 0) {
      https.end();
      secureClient.stop();
      secureClient.setInsecure();
      if (https.begin(secureClient, API_URL)) {
        https.addHeader("Content-Type", "application/json");
        httpResponseCode = https.POST(payload);
      }
    }

    if (httpResponseCode > 0) {
      String responseBody = https.getString();
      Serial.printf("[API REST] Codigo HTTP: %d | Resposta: %s\n", httpResponseCode, responseBody.c_str());
    } else {
      Serial.printf("[API REST] Falha no envio HTTPS: %s (Codigo: %d)\n",
                    https.errorToString(httpResponseCode).c_str(), httpResponseCode);
    }

    https.end();
  } else {
    Serial.println("[API REST] Nao foi possivel inicializar a conexao HTTPS.");
  }
}
