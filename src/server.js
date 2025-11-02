import Fastify from "fastify";
import rawBody from "@fastify/raw-body";
import Stripe from "stripe";
import dotenv from "dotenv";
import { supabaseAdmin } from "./supabase.js";

dotenv.config();

const app = Fastify({ logger: true });

await app.register(rawBody, { field: "rawBody", global: false, runFirst: true });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20"
});

app.get("/health", async () => ({ ok: true }));

app.post("/api/webhooks/stripe", { config: { rawBody: true } }, async (req, reply) => {
  const sig = req.headers["stripe-signature"];
  if (!sig) return reply.code(400).send({ error: "Missing stripe-signature" });

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    req.log.error({ err }, "stripe signature failed");
    return reply.code(400).send({ error: `Webhook Error: ${err.message}` });
  }

  const type = event.type;
  const data = event.data.object || {};

  const statusByType = {
    "invoice.payment_failed": "failed",
    "invoice.paid": "recovered",
    "invoice.payment_succeeded": "recovered"
  };

  if (statusByType[type]) {
    const amountCents = data.amount_paid ?? data.amount_due ?? data.amount ?? 0;

    const row = {
      stripe_event_id: event.id,
      customer_email: data.customer_email ?? data.customer ?? null,
      amount: (amountCents || 0) / 100,
      currency: (data.currency || "usd").toLowerCase(),
      status: statusByType[type],
      invoice_id: data.id
    };

    const { error } = await supabaseAdmin.from("receipts").upsert(row, {
      onConflict: "stripe_event_id"
    });
    if (error) {
      req.log.error({ error }, "supabase upsert failed");
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
