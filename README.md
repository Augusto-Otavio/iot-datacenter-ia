# Projeto Integrador de Monitoramento IoT — Data Center de IA (Rack de GPUs)

Sistema de monitoramento IoT desenvolvido em grupo integrando os **três blocos obrigatórios** exigidos pelo enunciado (**Sensor Simulado no Wokwi**, **API REST em Supabase Edge Function** e **Frontend Web no Cloudflare Pages**), relacionando os conceitos de **Arquitetura de Computadores** ao funcionamento da solução.

---

## 1. Proposta e Problema Escolhido

- **Problema:** Monitoramento contínuo de temperatura e umidade de um **Rack de Servidores/GPUs em um Data Center de Inteligência Artificial**, prevenindo *Thermal Throttling* (redução forçada de clock das GPUs/CPUs por superaquecimento) e falhas de hardware durante o treinamento de modelos.
- **Dispositivo e Sensor Simulado (Wokwi):** Microcontrolador **ESP32** (`wokwi-esp32-devkit-v1`) conectado ao sensor digital de temperatura e umidade **DHT22** (`GPIO 15`) e a um **LED de alerta térmico** (`GPIO 2`, atuador visual opcional).
- **Identificação do Dispositivo (`device_id`):** `esp32-rack-ia-01`
- **Grandeza monitorada (`metric`):** Temperatura do corredor do Rack de GPUs (`temperatura_rack_gpu`, em `°C`) e umidade relativa (`%`).
- **Intervalo de coleta:** `5 segundos` (`5000 ms`).
- **Tratamento simples aplicado no ESP32:**
  1. **Validação:** Verificação de leitura inválida (`isnan`) e limites físicos do sensor (`-40 °C` a `80 °C`).
  2. **Média Móvel:** Cálculo da média aritmética das últimas 3 leituras armazenadas em buffer circular na memória SRAM do ESP32 para filtrar flutuações rápidas de fluxo de ar.
  3. **Comparação com limite:** Comparação do valor tratado com o limite térmico máximo seguro do Rack de GPUs (`30,00 °C`).
- **Condição de alerta:** Ativada quando a temperatura média tratada é **maior que `30,00 °C`** (`value > 30.00` — risco de *Thermal Throttling*), acionando o LED vermelho no `GPIO 2` e enviando `"alert": true` para a API REST.

---

## 2. Arquitetura Adotada (Opção B — Envio Direto por HTTPS)

```text
[ESP32 + DHT22 no Wokwi (esp32-rack-ia-01)]
        │
        │  HTTPS POST (JSON a cada 5s)
        ▼
[API REST — Supabase Edge Function (/functions/v1/telemetry)]
        │
        │  INSERT / SELECT
        ▼
[Armazenamento Persistente — Supabase PostgreSQL (tabela telemetry_readings)]
        ▲
        │  HTTPS GET (Polling a cada 3s via API REST)
        │
[Painel Web Frontend — Cloudflare Pages]
```

---

## 3. Estrutura do Repositório

```text
iot-monitoramento/
├── wokwi/
│   ├── sketch.ino          # Código C++/Arduino do ESP32 (coleta, validação, média móvel, alerta >30°C e HTTPS POST)
│   ├── diagram.json        # Circuito completo do Wokwi (ESP32 + DHT22 a 22,5°C + LED + Resistor)
│   └── libraries.txt       # Bibliotecas necessárias no Wokwi (DHT sensor library)
├── supabase/
│   ├── schema.sql          # Estrutura do banco PostgreSQL (tabela telemetry_readings, índices e RLS)
│   └── functions/
│       └── telemetry/
│           └── index.ts    # API REST na Supabase Edge Function (rotas POST e GET com CORS)
├── frontend/
│   ├── index.html          # Painel web responsivo pronto para publicação no Cloudflare Pages
│   ├── styles.css          # Estilização visual com destaques de Alerta Térmico e Dados Desatualizados
│   └── app.js              # Consumo da API REST, gráfico de histórico e detecção de transmissão interrompida
├── docs/
│   └── RELATORIO_PROJETO_IOT.md # Relatório completo (2 a 4 páginas) com Arquitetura de Computadores e Testes
├── .env.example            # Modelo de configuração sem segredos
└── README.md               # Instruções completas de reprodução
```

---

## 4. Instruções de Reprodução (Passo a Passo)

### Passo 1 — Configurar o Banco de Dados no Supabase
1. Crie um projeto gratuito em [https://supabase.com](https://supabase.com).
2. No menu lateral do Supabase, abra o **SQL Editor**.
3. Copie e execute todo o conteúdo do arquivo [`supabase/schema.sql`](./supabase/schema.sql).
4. Isso criará a tabela `public.telemetry_readings`, os índices de busca e as políticas de segurança (RLS).

### Passo 2 — Publicar a API REST (Supabase Edge Function)
1. No menu lateral do Supabase, acesse **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nomeie a função como `telemetry`.
3. Cole o código de [`supabase/functions/telemetry/index.ts`](./supabase/functions/telemetry/index.ts).
4. Nas configurações da função (`Function Configuration`), desative a opção **Enforce JWT Verification** (ou utilize o header `Authorization: Bearer <SUPABASE_ANON_KEY>`).
5. Clique em **Deploy**. O endpoint HTTPS ficará disponível em:
   ```text
   https://<PROJECT_REF>.supabase.co/functions/v1/telemetry
   ```

### Passo 3 — Configurar e Executar o Sensor Simulado no Wokwi
1. Acesse [https://wokwi.com/projects/new/esp32](https://wokwi.com/projects/new/esp32).
2. Substitua o conteúdo de `sketch.ino` pelo código de [`wokwi/sketch.ino`](./wokwi/sketch.ino).
3. Na aba `diagram.json` do Wokwi, cole o conteúdo de [`wokwi/diagram.json`](./wokwi/diagram.json).
4. Crie/edite a aba `libraries.txt` no Wokwi com o conteúdo de [`wokwi/libraries.txt`](./wokwi/libraries.txt).
5. No arquivo `sketch.ino`, atualize a constante `API_URL` com a URL da sua Edge Function (`https://<PROJECT_REF>.supabase.co/functions/v1/telemetry`).
   - *Observação de segurança:* Ao salvar o projeto público ou versionar no GitHub, mantenha chaves sensíveis fora do repositório público.
6. Clique no botão **Start the simulation** (Play verde). Clique sobre o sensor **DHT22** durante a simulação para alterar o controle deslizante de **Temperatura** e testar valores normais de Data Center (`~22,5 °C`, `<= 30,0 °C`) e de superaquecimento/alerta (`> 30,0 °C`, ex.: `38,0 °C`).

### Passo 4 — Publicar o Painel Frontend no Cloudflare Pages
1. Acesse o painel da [Cloudflare](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → aba **Pages**.
2. Conecte ao seu repositório GitHub ou utilize **Direct Upload** enviando a pasta [`frontend/`](./frontend).
   - **Build output directory:** `iot-monitoramento/frontend` (ou `frontend`).
   - **Build command:** *(deixe em branco — HTML/CSS/JS estático puro)*.
3. Abra a URL pública gerada pelo Cloudflare Pages (`https://<seu-painel>.pages.dev`).
4. Clique em **Configurar API**, informe a URL da sua Supabase Edge Function (`https://<PROJECT_REF>.supabase.co/functions/v1/telemetry`) e clique em **Salvar e Consultar API**.

---

## 5. Roteiro de Testes Obrigatórios (Para o Vídeo de Demonstração)

1. **Fluxo completo do sensor até o painel:**
   - Com a simulação do Wokwi rodando (temperatura inicial do Rack em `22,5 °C`), mostre no Monitor Serial do Wokwi o log `[HTTPS POST]` com `HTTP 201`.
   - Mostre a chegada à API REST consultando diretamente a URL `https://<PROJECT_REF>.supabase.co/functions/v1/telemetry` no navegador (ou pelo quadro *"Consulta Direta à API REST (GET)"* / logs da Edge Function no Supabase).
   - Mostre o painel no Cloudflare Pages exibindo o valor atual (`22,50`), unidade (`°C`), horário da última atualização, gráfico e condição `NORMAL`.
2. **Situação de alerta (Superaquecimento do Rack de IA):**
   - No Wokwi, clique no sensor DHT22 e aumente a temperatura para `38,0 °C` (acima do limite térmico de `30,0 °C`).
   - Mostre o LED vermelho acendendo no Wokwi, o Monitor Serial indicando `ALERTA CRITICO (SUPERAQUECIMENTO / THERMAL THROTTLING!)`, o JSON chegando à API com `"alert": true` e o painel web ativando o banner vermelho pulsante `CONDIÇÃO DE ALERTA ATIVA`.
3. **Interrupção e retomada da transmissão:**
   - Pause/pare a simulação no Wokwi clicando no botão **Stop**.
   - Aguarde `15 segundos` com o painel aberto: o painel mudará automaticamente o status no topo para **Dados Desatualizados** e exibirá o alerta âmbar `DADOS DESATUALIZADOS — TRANSMISSÃO INTERROMPIDA`.
   - Clique novamente em **Start** no Wokwi: assim que a primeira leitura nova chegar à API, o painel removerá o aviso de desatualizado e voltará ao estado `Transmissão Ativa (Dados Atualizados)`.
4. **Armazenamento de leituras com o painel fechado:**
   - Feche a aba do painel web no navegador e deixe o Wokwi rodando por 20 a 30 segundos (gerando 4 a 6 leituras).
   - Reabra o painel web: verifique na tabela **Histórico de Leituras Armazenadas no Banco (Supabase)** que todas as leituras coletadas enquanto o painel estava fechado foram gravadas com seus respectivos horários e IDs sequenciais.
