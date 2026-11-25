# Roteiro Oficial de Apresentação e Vídeo (5 a 10 minutos)

Este roteiro segue **exatamente todas as orientações** do professor para o vídeo de apresentação em substituição à apresentação presencial:
- **Duração obrigatória:** `5 a 10 minutos`
- **Participação:** **Todos os integrantes** do grupo devem participar falando.
- **Formato:** Slides/diagrama + **gravação de tela demonstrando o sistema funcionando ao vivo** (não basta apenas slides).
- **Publicação:** YouTube com visibilidade **Não listado** (testar o link em janela anônima antes de enviar no Moodle).

---

## Preparação Antes de Gravar (3 Abas Abertas no Navegador)

1. **Aba 1 — Simulador Wokwi:** https://wokwi.com/projects/481616239057175553 *(com a simulação em execução e temperatura inicial em `22,5 °C`)*
2. **Aba 2 — API REST (Supabase Edge Function):** https://tvpctlctyjzgdfzcxyus.supabase.co/functions/v1/telemetry *(mostrando o JSON ao vivo)*
3. **Aba 3 — Painel Web Publicado (Cloudflare Pages):** https://iot-datacenter-ia.pages.dev *(mostrando temperatura, unidade, horário, gráfico e tabela)*

*(Dica: podem gravar via Google Meet / Discord com todos na chamada compartilhando a tela, ou via OBS Studio / gravador do Windows `Win + G`.)*

---

## Estrutura do Vídeo (5 a 10 minutos — Dupla: Otavio Augusto e Caio Garbin)

### 1. Contextualização (~1 a 1,5 min) — *Otavio Augusto*
- **Apresentar os integrantes:** falar os nomes completos (**Otavio Augusto** e **Caio Garbin**).
- **Problema escolhido:** Em Data Centers de Inteligência Artificial, racks de GPUs operam sob alta carga térmica; falhas de refrigeração causam *Thermal Throttling* (queda de clock e desempenho) ou desligamento de emergência.
- **Objetivo e definições do sistema:**
  - **Grandeza monitorada:** Temperatura (`°C`) e umidade (`%`) do corredor do rack (`esp32-rack-ia-01` / `temperatura_rack_gpu`).
  - **Intervalo de coleta:** a cada `5 segundos`.
  - **Condição de alerta:** temperatura média tratada acima de **`30,00 °C`** (aciona alerta crítico no painel e LED vermelho no GPIO 2).

---

### 2. Arquitetura e Conceitos de Arquitetura de Computadores (~2 a 2,5 min) — *Caio Garbin*
*(Mostrem o diagrama do arquivo `docs/RELATORIO_PROJETO_IOT.md` ou um slide simples com os 3 blocos)*

- **Fluxo completo (Opção B — Envio Direto por HTTPS):**
  `ESP32 + DHT22 (Wokwi)` $\rightarrow$ `API REST (Supabase Edge Function via HTTPS POST)` $\rightarrow$ `Banco PostgreSQL (Supabase)` $\leftarrow$ `Painel Web (Cloudflare Pages via HTTPS GET)`
- **Explicações obrigatórias de Arquitetura de Computadores:**
  1. **Comunicação ESP32 $\leftrightarrow$ Sensor:** O DHT22 possui ADC interno e se comunica com o pino **`GPIO 15`** por barramento digital **Single-Wire** (pulso de start + quadro de **40 bits** com umidade, temperatura e checksum, lidos pelos registradores e timers do ESP32).
  2. **Processamento e Armazenamento:**
     - **Na borda (ESP32):** A CPU **Xtensa Dual-Core LX6** e a memória **SRAM (volátil)** validam a leitura (`isnan` e faixa `-40 °C` a `80 °C`), calculam a **média móvel de 3 amostras** na FPU e comparam na ULA com o limite de `30,0 °C`.
     - **Na nuvem (Supabase):** Como a SRAM do ESP32 é volátil e limitada, a persistência permanente em disco ocorre no banco **PostgreSQL** (`telemetry_readings`).
  3. **Como a API conecta o dispositivo ao Frontend:** A Edge Function (`/functions/v1/telemetry`) recebe `HTTPS POST` (JSON) do ESP32 e responde `HTTPS GET` (última leitura + histórico) para o painel no Cloudflare Pages.
  4. **Impacto do intervalo de coleta (`5s`):** Respeita o limite físico do DHT22 (mínimo `2s`), evita sobrecarregar a CPU do ESP32 com handshakes TLS constantes, define a tolerância de `15s` ($3\times$) para detectar dados desatualizados e controla o volume de gravações no banco (`720 registros/hora`).

---

### 3. Demonstração Prática ao Vivo (~2,5 a 4 min) — *Otavio Augusto (Testes 1 e 2) + Caio Garbin (Testes 3 e 4)*
*(Compartilhando a tela com as 3 abas abertas e executando os 4 testes obrigatórios)*

1. **Teste 1 — Fluxo completo (Sensor $\rightarrow$ API REST $\rightarrow$ Painel) — *Otavio Augusto*:**
   - No **Wokwi**, mostre o DHT22 em `22,5 °C` e o Monitor Serial exibindo o payload JSON enviado por `[HTTPS POST]` com `Codigo HTTP: 201`.
   - Mude para a **Aba da API REST** (`.../functions/v1/telemetry`), dê F5 e mostre o dado recém-chegado no JSON (`"value": 22.5`, `"alert": false`).
   - Mude para a **Aba do Painel Web** (`https://iot-datacenter-ia.pages.dev`) e mostre o valor atual `22.50 °C`, unidade `°C`, horário da última atualização, gráfico e status verde `NORMAL`.
2. **Teste 2 — Situação de Alerta (`> 30 °C`) — *Otavio Augusto*:**
   - No **Wokwi**, clique no sensor DHT22 e arraste a temperatura para **`38,0 °C`**.
   - Aguarde ~15 segundos (3 leituras para a média móvel ultrapassar `30 °C`): mostre o **LED vermelho acendendo** no ESP32, o Monitor Serial indicando `ALERTA CRITICO`, o dado chegando na **API** com `"alert": true` e o **Painel Web** exibindo o banner vermelho pulsante **`CONDIÇÃO DE ALERTA ATIVA`**.
   - *(Volte a temperatura para `22,5 °C` para mostrar o retorno ao normal.)*
3. **Teste 3 — Interrupção e Retomada da Transmissão (`Dados Desatualizados`) — *Caio Garbin*:**
   - No **Wokwi**, clique no botão **Stop** para interromper a transmissão.
   - Aguarde **15 segundos** mostrando o **Painel Web**: o status mudará automaticamente para amarelo (**`Dados Desatualizados`**) com o banner **`⚠️ DADOS DESATUALIZADOS — TRANSMISSÃO INTERROMPIDA`**.
   - Clique em **Play** novamente no **Wokwi**: assim que a primeira leitura nova chegar à API, mostre no painel o aviso sumindo e voltando para **`Transmissão Ativa (Dados Atualizados)`**.
4. **Teste 4 — Armazenamento com o Painel Fechado — *Caio Garbin*:**
   - Observe o último `#ID` na tabela do painel e **feche a aba do Painel Web**.
   - Deixe o **Wokwi** rodando por **20 segundos** (gerando ~4 leituras novas).
   - Abra novamente `https://iot-datacenter-ia.pages.dev`: role até a tabela **Histórico de Leituras Armazenadas no Banco (Supabase)** e mostre os novos IDs gravados enquanto o painel esteve fechado.

---

### 4. Conclusão (~1 a 1,5 min) — *Otavio Augusto e Caio Garbin*
- **Principais dificuldades enfrentadas e resolvidas:**
  - Configuração de permissões SQL (`GRANT` + RLS) no Supabase para liberar inserção/leitura via Edge Function.
  - Otimização de rede no ESP32 com `https.setReuse(true)` (*Keep-Alive*) para evitar bloqueio/throttling de múltiplas sessões TLS no gateway público do Wokwi (`Wokwi-GUEST`).
- **Limitações da solução:**
  - Ausência de fila offline em memória Flash (SPIFFS/LittleFS) caso a rede Wi-Fi caia.
  - Uso de `setInsecure()` no TLS para ambiente de simulação (em produção deve-se fixar o certificado raiz/Root CA).
  - Atualização do painel por *polling* HTTP a cada 3s em vez de *WebSockets/SSE*.
- **Contribuições dos integrantes:** citar brevemente a divisão entre **Otavio Augusto** (ESP32/Wokwi, Edge Function e Cloudflare Pages) e **Caio Garbin** (banco PostgreSQL, validação do Frontend, testes integrados e relatório/apresentação).

---

## Checklist Final de Entrega no Moodle

1. **Entrega do Projeto (até quarta, 25 nov. 2026, 23:59):**
   - Preencher os **nomes/usuários do grupo** e o **link do vídeo do YouTube** em `docs/RELATORIO_PROJETO_IOT.md` e exportar para **PDF (2 a 4 páginas)**.
   - Conferir no PDF se constam todos os links: GitHub (`https://github.com/Augusto-Otavio/iot-datacenter-ia`), Wokwi (`https://wokwi.com/projects/481616239057175553`), Painel (`https://iot-datacenter-ia.pages.dev`) e Vídeo (YouTube Não Listado).
   - Um integrante envia o PDF no Moodle em nome do grupo.
2. **Entrega do Vídeo de Apresentação (até quarta, 02 dez. 2026, 23:59):**
   - Subir o vídeo de **5 a 10 minutos** no YouTube como **Não listado**.
   - Testar o link do vídeo em uma **aba anônima** do navegador para confirmar que abre sem pedir login.
   - Um integrante envia no Moodle: **Nome do projeto**, **Nomes dos integrantes** e **Link do vídeo**.
