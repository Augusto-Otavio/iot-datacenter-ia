// ============================================================================
// Projeto Integrador de Monitoramento IoT
// Bloco 2: API REST em uma Supabase Edge Function via HTTPS
// Caminho: supabase/functions/telemetry/index.ts
//
// Responsabilidades exigidas pelo enunciado:
// 1. Receber as leituras do ESP32 por HTTPS (POST)
// 2. Identificar o dispositivo (device_id) e a grandeza medida (metric)
// 3. Armazenar os dados no Supabase mesmo com o painel fechado
// 4. Disponibilizar a leitura mais recente (latest) e o histórico (history) para consulta (GET)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Tratamento de preflight CORS para permitir consultas do painel no Cloudflare Pages
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // As credenciais ficam nas variáveis de ambiente da plataforma (fora do código público)
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY") ??
    "";

  if (!supabaseUrl || !supabaseKey) {
    return new Response(
      JSON.stringify({
        error: "Variáveis de ambiente SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // ========================================================================
    // ROTA POST: Recebe uma nova leitura enviada pelo ESP32 via HTTPS
    // ========================================================================
    if (req.method === "POST") {
      const body = await req.json();

      const device_id = String(body.device_id ?? "").trim();
      const metric = String(body.metric ?? "").trim();
      const value = Number(body.value);
      const raw_value = body.raw_value !== undefined ? Number(body.raw_value) : value;
      const humidity = body.humidity !== undefined ? Number(body.humidity) : null;
      const unit = String(body.unit ?? "°C").trim();
      const threshold = body.threshold !== undefined ? Number(body.threshold) : 30.0;
      const alert =
        typeof body.alert === "boolean" ? body.alert : value > threshold;

      // Validação obrigatória: identificar o dispositivo, a grandeza medida e o valor numérico
      if (!device_id || !metric || Number.isNaN(value)) {
        return new Response(
          JSON.stringify({
            error: "Campos obrigatórios ausentes ou inválidos: device_id, metric, value",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Log de recebimento na Edge Function (para demonstração no vídeo)
      console.log(
        `[RECEBIDO ESP32] Dispositivo=${device_id} | Grandeza=${metric} | Valor=${value}${unit} | Bruto=${raw_value}${unit} | Alerta=${alert}`
      );

      // Persistência no banco Supabase (ocorre de forma independente do painel estar aberto ou fechado)
      const { data, error } = await supabase
        .from("telemetry_readings")
        .insert([
          {
            device_id,
            metric,
            value,
            raw_value,
            humidity,
            unit,
            threshold,
            alert,
          },
        ])
        .select()
        .single();

      if (error) {
        console.error("[ERRO SUPABASE INSERT]", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          status: "ok",
          message: "Leitura recebida e armazenada com sucesso",
          reading: data,
        }),
        {
          status: 201,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ========================================================================
    // ROTA GET: Disponibiliza a leitura mais recente e o histórico para o Frontend
    // ========================================================================
    if (req.method === "GET") {
      const url = new URL(req.url);
      const deviceIdFilter = url.searchParams.get("device_id");
      const limitParam = Number(url.searchParams.get("limit") ?? "25");
      const limit = Number.isNaN(limitParam) ? 25 : Math.min(Math.max(limitParam, 1), 100);

      let query = supabase
        .from("telemetry_readings")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (deviceIdFilter) {
        query = query.eq("device_id", deviceIdFilter);
      }

      const { data: rows, error } = await query;

      if (error) {
        console.error("[ERRO SUPABASE SELECT]", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const history = rows ?? [];
      const latest = history.length > 0 ? history[0] : null;

      return new Response(
        JSON.stringify({
          status: "ok",
          server_time: new Date().toISOString(),
          count: history.length,
          latest,
          history,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: `Método HTTP ${req.method} não suportado.` }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[ERRO INTERNO EDGE FUNCTION]", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Erro inesperado na API REST",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
