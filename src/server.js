import Fastify from "fastify";
import fastifyRawBody from "fastify-raw-body";
import Stripe from "stripe";
import dotenv from "dotenv";
import { supabaseAdmin } from "./supabase.js";

dotenv.config();

const app = Fastify({ logger: true });
await app.register(fastifyRawBody, { field: "rawBody", global: false, runFirst: true });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const DIAG_TOKEN = process.env.DIAG_TOKEN || "";

/* ---------- health ---------- */
app.get("/health", async () => ({ ok: true }));

/* ---------- diagnostics (temporary) ---------- */
function authed(req) {
  const hdr = req.headers["x-diag-token"];
  const q = (req.query && (req.query.token || req.query.t)) || undefined;
  return DIAG_TOKEN && (hdr === DIAG_TOKEN || q === DIAG_TOKEN);
}

// env presence (booleans only)
app.get("/diag/env", async (req, reply) => {
  if (!authed(req)) return reply.code(401).send({ ok: false, error: "unauthorized" });
  return reply.send({
    node: process.versions.node,
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    hasStripeSecret: !!process.env.STRIPE_SECRET_KEY,
    hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
  });
});

// direct DB write test (no Stripe needed)
app.post("/diag/db", async (req, reply) => {
  if (!authed(req)) return reply.code(401).send({ ok: false, error: "unauthorized" });

  const row = {
    stripe_event_id: "diag_" + Date.now(),
    customer_email: "diag@example.com",
    amount: 12.34,
    currency: "usd",
    status: "recovered",
    invoice_id: "diag_inv_" + Date.now(),
  };

  const { error } = await supabaseAdmin.from("receipts").upsert(row, { onConflict: "stripe_event_id" });
  if (error) {
    app.log.error({ error_detail: error }, "diag supabase upsert failed");
    return reply.code(500).send({ ok: false, error: "db_write_failed", detail: error.message || error });
  }
  return reply.send({ ok: true });
});

/* ---------- Stripe webhook ---------- */
app.post("/api/webhooks/stripe", { config: { rawBody: true } }, async (req, reply) => {
  const sig = req.headers["stripe-signature"];
  if (!sig) return reply.code(400).send({ error: "Missing stripe-signature" });

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    req.log.error({ err }, "stripe signature failed");
    return reply.code(400).send({ error: `Webhook Error: ${err.message}` });
  }

  const type = event.type;
  const data = event.data.object || {};

  const statusByType = {
    "invoice.payment_failed": "failed",
    "invoice.paid": "recovered",
    "invoice.payment_succeeded": "recovered",
  };

  // helper to pick the first non-null/undefined value
  const pick = (...vals) => vals.find((v) => v !== undefined && v !== null);

  if (statusByType[type]) {
    // More robust across invoice events:
    // - failures often have amount_remaining / total
    // - successes have amount_paid / total
    const amountCents = pick(
      data.amount_remaining,
      data.amount_due,
      data.total,
      data.subtotal,
      data.amount_paid,
      data.amount
    );

    const row = {
      stripe_event_id: event.id,
      customer_email: data.customer_email ?? data.customer ?? null,
      amount: ((amountCents ?? 0) / 100),
      currency: (data.currency || "usd").toLowerCase(),
      status: statusByType[type],
      invoice_id: data.id,
    };

    const { error } = await supabaseAdmin.from("receipts").upsert(row, { onConflict: "stripe_event_id" });
    if (error) {
      req.log.error({ error_detail: error }, "supabase upsert failed detail");
      return reply.code(500).send({ error: "DB write failed" });
    }
  }

  reply.send({ received: true });
});

const PORT = Number(process.env.PORT || 8080);
app.listen({ port: PORT, host: "0.0.0.0" }).catch((e) => {
  console.error(e);
  process.exit(1);
});
