#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <DHT.h>

// Rede Wi-Fi do simulador Wokwi
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASSWORD = "";

// Endpoint da API REST no Supabase
const char* API_URL = "https://tvpctlctyjzgdfzcxyus.supabase.co/functions/v1/telemetry";

// Identificacao do dispositivo e grandeza monitorada
const char* DEVICE_ID = "esp32-rack-ia-01";
const char* METRIC_NAME = "temperatura_rack_gpu";
const char* METRIC_UNIT = "°C";

// Pinos usados no ESP32
#define DHTPIN 15
#define DHTTYPE DHT22
#define LED_ALERTA 2

DHT dht(DHTPIN, DHTTYPE);
WiFiClientSecure clienteTLS;
HTTPClient https;

// Regras de coleta e alerta (> 30 °C)
const unsigned long INTERVALO_COLETA_MS = 5000;
const float LIMITE_ALERTA = 30.0;
const float TEMP_MIN = -40.0;
const float TEMP_MAX = 80.0;

// Buffer da media movel (ultimas 3 leituras)
const int TAMANHO_JANELA = 3;
float bufferTemp[TAMANHO_JANELA];
int indiceBuffer = 0;
int totalAmostras = 0;
unsigned long ultimaColeta = 0;

float calcularMediaMovel(float novaLeitura) {
  bufferTemp[indiceBuffer] = novaLeitura;
  indiceBuffer = (indiceBuffer + 1) % TAMANHO_JANELA;

  if (totalAmostras < TAMANHO_JANELA) {
    totalAmostras++;
  }

  float soma = 0.0;
  for (int i = 0; i < totalAmostras; i++) {
    soma += bufferTemp[i];
  }

  return soma / totalAmostras;
}

void conectarWiFi() {
  Serial.print("[WiFi] Conectando em ");
  Serial.println(WIFI_SSID);

  WiFi.disconnect(true);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, 6);

  int tentativas = 0;
  while (WiFi.status() != WL_CONNECTED && tentativas < 30) {
    delay(400);
    Serial.print(".");
    tentativas++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Conectado! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[WiFi] Falha ao conectar, tentando novamente no proximo ciclo.");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_ALERTA, OUTPUT);
  digitalWrite(LED_ALERTA, LOW);

  dht.begin();
  clienteTLS.setInsecure();
  https.setReuse(true); // Reaproveita a conexao TLS entre envios

  Serial.println("Monitoramento Termico - Rack IA (esp32-rack-ia-01)");
  conectarWiFi();
}

void loop() {
  unsigned long agora = millis();
  if (agora - ultimaColeta < INTERVALO_COLETA_MS) {
    return;
  }
  ultimaColeta = agora;

  float tempBruta = dht.readTemperature();
  float umidade = dht.readHumidity();

  // Descarta leituras invalidas ou fora da faixa do sensor
  if (isnan(tempBruta) || isnan(umidade) || tempBruta < TEMP_MIN || tempBruta > TEMP_MAX) {
    Serial.println("[Erro] Falha ao ler o sensor DHT22.");
    return;
  }

  // Calcula media movel e verifica se passou do limite
  float tempMedia = calcularMediaMovel(tempBruta);
  bool alerta = (tempMedia > LIMITE_ALERTA);
  digitalWrite(LED_ALERTA, alerta ? HIGH : LOW);

  Serial.printf("Temp bruta: %.2f °C | Media: %.2f °C | Umidade: %.1f%% | Status: %s\n",
                tempBruta, tempMedia, umidade, alerta ? "ALERTA (> 30 °C)" : "NORMAL");

  if (WiFi.status() != WL_CONNECTED) {
    conectarWiFi();
  }

  char payload[320];
  snprintf(
    payload,
    sizeof(payload),
    "{\"device_id\":\"%s\",\"metric\":\"%s\",\"value\":%.2f,\"raw_value\":%.2f,\"humidity\":%.1f,\"unit\":\"%s\",\"threshold\":%.2f,\"alert\":%s}",
    DEVICE_ID,
    METRIC_NAME,
    tempMedia,
    tempBruta,
    umidade,
    METRIC_UNIT,
    LIMITE_ALERTA,
    alerta ? "true" : "false"
  );

  if (https.begin(clienteTLS, API_URL)) {
    https.setTimeout(8000);
    https.addHeader("Content-Type", "application/json");
    https.addHeader("Connection", "keep-alive");

    int codigoHttp = https.POST(payload);

    // Se a conexao antiga cair no gateway, abre uma nova uma vez
    if (codigoHttp < 0) {
      https.end();
      clienteTLS.stop();
      clienteTLS.setInsecure();
      if (https.begin(clienteTLS, API_URL)) {
        https.addHeader("Content-Type", "application/json");
        codigoHttp = https.POST(payload);
      }
    }

    if (codigoHttp > 0) {
      Serial.printf("[API] HTTP %d -> %s\n", codigoHttp, https.getString().c_str());
    } else {
      Serial.printf("[API] Erro no envio HTTPS (%d): %s\n",
                    codigoHttp, https.errorToString(codigoHttp).c_str());
    }

    https.end();
  }
}
