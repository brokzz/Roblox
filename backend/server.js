import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import "dotenv/config";

import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors({ origin: true, methods: ["GET", "POST"] }));
app.use(express.json());

// ===== Servir o front (public) =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// ===== ENV =====
const PORT = process.env.PORT || 3000;

const BASE = process.env.SLIMPAY_BASE;                 // https://app.slimmpayy.com.br/api/v1
const PUBLIC_KEY = process.env.SLIMPAY_PUBLIC_KEY;     // x-public-key
const SECRET_KEY = process.env.SLIMPAY_SECRET_KEY;     // x-secret-key

const CREATE_PIX_PATH = process.env.SLIMPAY_CREATE_PIX_PATH; // /gateway/pix/receive
const QUERY_TX_PATH = process.env.SLIMPAY_QUERY_TX_PATH;     // /gateway/transactions

function need(name, v) {
  if (!v) throw new Error(`Faltando no .env: ${name}`);
}
try {
  need("SLIMPAY_BASE", BASE);
  need("SLIMPAY_PUBLIC_KEY", PUBLIC_KEY);
  need("SLIMPAY_SECRET_KEY", SECRET_KEY);
  need("SLIMPAY_CREATE_PIX_PATH", CREATE_PIX_PATH);
  need("SLIMPAY_QUERY_TX_PATH", QUERY_TX_PATH);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

// ===== Helpers =====
function buildUrl(p) {
  const base = BASE.endsWith("/") ? BASE : `${BASE}/`;
  const clean = String(p || "").replace(/^\//, "");
  return new URL(clean, base).toString();
}

function slimpayHeaders() {
  return {
    "Content-Type": "application/json",
    "x-public-key": PUBLIC_KEY,
    "x-secret-key": SECRET_KEY,
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function readResponseSafe(resp) {
  const contentType = resp.headers.get("content-type") || "";
  const text = await resp.text().catch(() => "");
  const isJson = contentType.includes("application/json");
  if (isJson) {
    try {
      return { kind: "json", data: JSON.parse(text), raw: text };
    } catch {
      return { kind: "text", data: text, raw: text };
    }
  }
  return { kind: "text", data: text, raw: text };
}

function onlyDigits(v = "") {
  return String(v).replace(/\D/g, "");
}

// Validação simples (CPF/CNPJ) — evita 422 "Documento inválido."
function isValidDocument(doc) {
  const d = onlyDigits(doc);

  // CPF (11) ou CNPJ (14)
  if (d.length === 11) {
    // rejeita sequências tipo 00000000000
    if (/^(\d)\1+$/.test(d)) return false;

    // valida dígitos do CPF (cálculo oficial)
    const calc = (base) => {
      let sum = 0;
      for (let i = 0; i < base.length; i++) {
        sum += Number(base[i]) * (base.length + 1 - i);
      }
      const r = (sum * 10) % 11;
      return r === 10 ? 0 : r;
    };
    const d1 = calc(d.slice(0, 9));
    const d2 = calc(d.slice(0, 9) + String(d1));
    return d.endsWith(String(d1) + String(d2));
  }

  if (d.length === 14) {
    // valida CNPJ (básico)
    if (/^(\d)\1+$/.test(d)) return false;
    const calc = (base, weights) => {
      let sum = 0;
      for (let i = 0; i < weights.length; i++) sum += Number(base[i]) * weights[i];
      const r = sum % 11;
      return r < 2 ? 0 : 11 - r;
    };
    const w1 = [5,4,3,2,9,8,7,6,5,4,3,2];
    const w2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
    const d1 = calc(d, w1);
    const d2 = calc(d.slice(0, 12) + String(d1), w2);
    return d.endsWith(String(d1) + String(d2));
  }

  return false;
}

// Normaliza base64: se vier só "iVBORw0..." vira "data:image/png;base64,iVBORw0..."
function normalizeBase64(b64) {
  if (!b64) return null;
  const s = String(b64);
  if (s.startsWith("data:image")) return s;
  return `data:image/png;base64,${s}`;
}

// ===== Anti-spam / Cache do status (evita 403 do gateway) =====
// cache por transação: se pedir status de novo antes de 15s, devolve o cache
const statusCache = new Map(); // key -> { ts, payload }
const STATUS_MIN_INTERVAL_MS = 15000; // 15s

function cacheKey({ transactionId, clientIdentifier }) {
  return transactionId ? `id:${transactionId}` : `cid:${clientIdentifier}`;
}

app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * POST /api/pix/create
 */
app.post("/api/pix/create", async (req, res) => {
  try {
    const url = buildUrl(CREATE_PIX_PATH);
    console.log("CREATE URL:", url);

    const amount = 1000.0;

    const client = {
      name: req.body?.client?.name || "Cliente",
      email: req.body?.client?.email || "cliente@exemplo.com",
      phone: req.body?.client?.phone || "(51) 99999-9999",
      document: req.body?.client?.document || "059.851.150-46", // exemplo
    };

    // valida documento antes de chamar o gateway
    if (!isValidDocument(client.document)) {
      return res.status(400).json({
        error: "invalid_document",
        message: "Documento inválido. Envie CPF (11 dígitos) ou CNPJ (14 dígitos) válido em client.document."
      });
    }

    const identifier = `sellerpass_${Date.now()}`;

    const payload = {
      identifier,
      amount,
      client: {
        ...client,
        document: onlyDigits(client.document) // manda só dígitos (mais compatível)
      },
     products: [
  { id: "seller-pass", name: "Seller Pass", quantity: 1, price: amount, physical: false }
],
      metadata: { provider: "SellerPass", identifier }
      // callbackUrl: "https://..." // opcional
    };

    const r = await fetchWithTimeout(url, {
      method: "POST",
      headers: slimpayHeaders(),
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const parsed = await readResponseSafe(r);
      console.log("GATEWAY STATUS:", r.status);
      console.log("GATEWAY BODY:", parsed.raw);
      return res.status(502).json({ error: "gateway_error", details: parsed.data });
    }

    const parsed = await readResponseSafe(r);
    const data = parsed.kind === "json" ? parsed.data : { raw: parsed.data };

    const pixBase64 = normalizeBase64(data?.pix?.base64);

    return res.json({
      clientIdentifier: identifier,
      transactionId: data.transactionId,
      status: data.status,
      fee: data.fee,
      pixCode: data?.pix?.code || null,
      pixBase64,
      pixImage: data?.pix?.image || null,
      raw: data
    });

  } catch (e) {
    const isTimeout = e?.name === "AbortError";
    return res.status(500).json({ error: isTimeout ? "timeout" : "server_error", details: String(e?.message || e) });
  }
});

/**
 * GET /api/pix/status?transactionId=... OR ?clientIdentifier=...
 * Protegido com cache + intervalo mínimo (evita 403 "Tentativa de polling bloqueada!")
 */
app.get("/api/pix/status", async (req, res) => {
  try {
    const { transactionId, clientIdentifier } = req.query;

    if (!transactionId && !clientIdentifier) {
      return res.status(400).json({ error: "missing_transactionId_or_clientIdentifier" });
    }

    const key = cacheKey({ transactionId, clientIdentifier });
    const now = Date.now();

    // 1) se consultou há menos de 15s, devolve cache (não chama gateway)
    const cached = statusCache.get(key);
    if (cached && (now - cached.ts) < STATUS_MIN_INTERVAL_MS) {
      return res.json({ ...cached.payload, cached: true });
    }

    const qs = transactionId
      ? `?id=${encodeURIComponent(transactionId)}`
      : `?clientIdentifier=${encodeURIComponent(clientIdentifier)}`;

    const url = buildUrl(QUERY_TX_PATH) + qs;
    console.log("STATUS URL:", url);

    const r = await fetchWithTimeout(url, {
      method: "GET",
      headers: slimpayHeaders(),
    });

    const parsed = await readResponseSafe(r);

    // 2) se gateway bloqueou polling: devolve 429 (front para de insistir)
    if (!r.ok) {
      console.log("GATEWAY STATUS:", r.status);
      console.log("GATEWAY BODY:", parsed.raw);

      // Slimpay retorna 403 com {"error":"Tentativa de polling bloqueada!"}
      if (r.status === 403) {
        return res.status(429).json({
          error: "polling_blocked",
          message: "Consulta automática bloqueada pela API. Aguarde e use o botão “Já paguei” para verificar.",
          details: parsed.data
        });
      }

      return res.status(502).json({ error: "gateway_error", details: parsed.data });
    }

    const data = parsed.kind === "json" ? parsed.data : { raw: parsed.data };

    const payload = {
      id: data.id,
      clientIdentifier: data.clientIdentifier,
      status: data.status,
      paymentMethod: data.paymentMethod,
      pixInformation: data.pixInformation || null,
      raw: data,
      cached: false
    };

    // 3) salva cache
    statusCache.set(key, { ts: now, payload });

    return res.json(payload);

  } catch (e) {
    const isTimeout = e?.name === "AbortError";
    return res.status(500).json({ error: isTimeout ? "timeout" : "server_error", details: String(e?.message || e) });
  }
});

app.listen(PORT, () => console.log(`Backend rodando em http://localhost:${PORT}`));