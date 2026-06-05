import "dotenv/config";

import { env } from "../config/env.js";
import { closePool, getPool } from "../db/pool.js";
import { generateApiKey, hashApiKey } from "../security/apiKeys.js";
import {
  DEMO_API_KEY_ID,
  DEMO_AUDIT_LOG_ID,
  DEMO_CREDIT_ID,
  DEMO_CUSTOMER_ID,
  DEMO_DRAFT_INVOICE_ID,
  DEMO_DRAFT_LINE_ITEM_ID,
  DEMO_ISSUED_INVOICE_ID,
  DEMO_ISSUED_LINE_ITEM_ID,
  DEMO_PAID_INVOICE_ID,
  DEMO_PAID_LINE_ITEM_ID,
  DEMO_PRICE_PLAN_ID,
  DEMO_PRICE_TIER_1_ID,
  DEMO_PRICE_TIER_2_ID,
  DEMO_PRICE_TIER_3_ID,
  DEMO_SECOND_API_KEY_ID,
  DEMO_SECOND_AUDIT_LOG_ID,
  DEMO_SECOND_CUSTOMER_ID,
  DEMO_SECOND_DRAFT_INVOICE_ID,
  DEMO_SECOND_DRAFT_LINE_ITEM_ID,
  DEMO_SECOND_ISSUED_INVOICE_ID,
  DEMO_SECOND_ISSUED_LINE_ITEM_ID,
} from "./demoIds.js";
import { generateUsage } from "./generateUsage.js";

export async function seedDemoData() {
  const pool = getPool();
  const client = await pool.connect();
  const demoApiKey = generateApiKey();
  const secondDemoApiKey = generateApiKey();
  let apiKeyToken: string | undefined;
  let secondApiKeyToken: string | undefined;

  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO price_plans (id, name)
        VALUES ($1, 'Demo Growth')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
      `,
      [DEMO_PRICE_PLAN_ID],
    );
    await client.query(
      `
        INSERT INTO price_tiers (id, price_plan_id, min_units, max_units, unit_price_micros)
        VALUES
          ($1, $4, 0, 10000, 10000),
          ($2, $4, 10000, 100000, 1000),
          ($3, $4, 100000, NULL, 500)
        ON CONFLICT (id) DO UPDATE
        SET
          price_plan_id = EXCLUDED.price_plan_id,
          min_units = EXCLUDED.min_units,
          max_units = EXCLUDED.max_units,
          unit_price_micros = EXCLUDED.unit_price_micros
      `,
      [DEMO_PRICE_TIER_1_ID, DEMO_PRICE_TIER_2_ID, DEMO_PRICE_TIER_3_ID, DEMO_PRICE_PLAN_ID],
    );
    await client.query(
      `
        INSERT INTO customers (id, name, email, price_plan_id)
        VALUES
          ($1, 'Acme AI', 'billing@acme.test', $3),
          ($2, 'Nova Robotics', 'finance@nova.test', $3)
        ON CONFLICT (id) DO UPDATE
        SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          price_plan_id = EXCLUDED.price_plan_id
      `,
      [DEMO_CUSTOMER_ID, DEMO_SECOND_CUSTOMER_ID, DEMO_PRICE_PLAN_ID],
    );

    const apiKeyResult = await client.query<{ id: string }>(
      `
        INSERT INTO api_keys (id, customer_id, key_prefix, key_hash)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
      [DEMO_API_KEY_ID, DEMO_CUSTOMER_ID, demoApiKey.keyPrefix, hashApiKey(demoApiKey.token, env.API_KEY_PEPPER)],
    );
    apiKeyToken = apiKeyResult.rows[0] ? demoApiKey.token : undefined;

    const secondApiKeyResult = await client.query<{ id: string }>(
      `
        INSERT INTO api_keys (id, customer_id, key_prefix, key_hash)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `,
      [
        DEMO_SECOND_API_KEY_ID,
        DEMO_SECOND_CUSTOMER_ID,
        secondDemoApiKey.keyPrefix,
        hashApiKey(secondDemoApiKey.token, env.API_KEY_PEPPER),
      ],
    );
    secondApiKeyToken = secondApiKeyResult.rows[0] ? secondDemoApiKey.token : undefined;

    await seedInvoices(client);
    await seedSecondCustomerInvoices(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const usage = await generateUsage({
    customerId: DEMO_CUSTOMER_ID,
    apiKeyId: DEMO_API_KEY_ID,
    hours: 72,
    eventsPerHour: 3,
    unitsPerEvent: 250,
    endpoint: "/v1/completions",
  });
  const secondUsage = await generateUsage({
    customerId: DEMO_SECOND_CUSTOMER_ID,
    apiKeyId: DEMO_SECOND_API_KEY_ID,
    hours: 72,
    eventsPerHour: 1,
    unitsPerEvent: 100,
    endpoint: "/v1/embeddings",
  });

  return {
    apiKeyToken,
    secondApiKeyToken,
    usageEventsInserted: usage.inserted + secondUsage.inserted,
  };
}

async function seedInvoices(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }) {
  await client.query(
    `
      INSERT INTO invoices (
        id,
        customer_id,
        period_start,
        period_end,
        status,
        subtotal_cents,
        credits_cents,
        total_cents,
        issued_at,
        paid_at
      )
      VALUES
        ($1, $2, '2026-06-01', '2026-07-01', 'draft', 10000, 0, 10000, NULL, NULL),
        ($3, $2, '2026-05-01', '2026-06-01', 'issued', 12000, 500, 11500, now() - interval '3 days', NULL),
        ($4, $2, '2026-04-01', '2026-05-01', 'paid', 9000, 0, 9000, now() - interval '33 days', now() - interval '30 days')
      ON CONFLICT (id) DO UPDATE
      SET
        status = EXCLUDED.status,
        subtotal_cents = EXCLUDED.subtotal_cents,
        credits_cents = EXCLUDED.credits_cents,
        total_cents = EXCLUDED.total_cents,
        issued_at = EXCLUDED.issued_at,
        paid_at = EXCLUDED.paid_at
    `,
    [DEMO_DRAFT_INVOICE_ID, DEMO_CUSTOMER_ID, DEMO_ISSUED_INVOICE_ID, DEMO_PAID_INVOICE_ID],
  );
  await client.query(
    `
      INSERT INTO invoice_line_items (
        id,
        invoice_id,
        description,
        units,
        unit_price_micros,
        amount_cents
      )
      VALUES
        ($1, $2, 'Demo current-period usage', 100000, 1000, 10000),
        ($3, $4, 'Demo issued invoice usage', 120000, 1000, 12000),
        ($5, $6, 'Demo paid invoice usage', 90000, 1000, 9000)
      ON CONFLICT (id) DO UPDATE
      SET
        description = EXCLUDED.description,
        units = EXCLUDED.units,
        unit_price_micros = EXCLUDED.unit_price_micros,
        amount_cents = EXCLUDED.amount_cents
    `,
    [
      DEMO_DRAFT_LINE_ITEM_ID,
      DEMO_DRAFT_INVOICE_ID,
      DEMO_ISSUED_LINE_ITEM_ID,
      DEMO_ISSUED_INVOICE_ID,
      DEMO_PAID_LINE_ITEM_ID,
      DEMO_PAID_INVOICE_ID,
    ],
  );
  await client.query(
    `
      INSERT INTO credits (id, customer_id, invoice_id, amount_cents, reason, idempotency_key, created_by)
      VALUES ($1, $2, $3, 500, 'Demo courtesy credit', 'demo-credit-issued-invoice', 'seed-script')
      ON CONFLICT (id) DO NOTHING
    `,
    [DEMO_CREDIT_ID, DEMO_CUSTOMER_ID, DEMO_ISSUED_INVOICE_ID],
  );
  await client.query(
    `
      INSERT INTO audit_logs (
        id,
        actor,
        action,
        entity_type,
        entity_id,
        before_value,
        after_value,
        reason
      )
      VALUES (
        $1,
        'seed-script',
        'credit.created',
        'invoice',
        $2,
        '{"credits_cents":0,"total_cents":12000}'::jsonb,
        '{"credits_cents":500,"total_cents":11500}'::jsonb,
        'Demo courtesy credit'
      )
      ON CONFLICT (id) DO NOTHING
    `,
    [DEMO_AUDIT_LOG_ID, DEMO_ISSUED_INVOICE_ID],
  );
}

async function seedSecondCustomerInvoices(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }) {
  await client.query(
    `
      INSERT INTO invoices (
        id,
        customer_id,
        period_start,
        period_end,
        status,
        subtotal_cents,
        credits_cents,
        total_cents,
        issued_at,
        paid_at
      )
      VALUES
        ($1, $2, '2026-06-01', '2026-07-01', 'draft', 4500, 0, 4500, NULL, NULL),
        ($3, $2, '2026-05-01', '2026-06-01', 'issued', 6500, 0, 6500, now() - interval '2 days', NULL)
      ON CONFLICT (id) DO UPDATE
      SET
        status = EXCLUDED.status,
        subtotal_cents = EXCLUDED.subtotal_cents,
        credits_cents = EXCLUDED.credits_cents,
        total_cents = EXCLUDED.total_cents,
        issued_at = EXCLUDED.issued_at,
        paid_at = EXCLUDED.paid_at
    `,
    [DEMO_SECOND_DRAFT_INVOICE_ID, DEMO_SECOND_CUSTOMER_ID, DEMO_SECOND_ISSUED_INVOICE_ID],
  );
  await client.query(
    `
      INSERT INTO invoice_line_items (
        id,
        invoice_id,
        description,
        units,
        unit_price_micros,
        amount_cents
      )
      VALUES
        ($1, $2, 'Nova current-period embeddings usage', 45000, 1000, 4500),
        ($3, $4, 'Nova issued invoice usage', 65000, 1000, 6500)
      ON CONFLICT (id) DO UPDATE
      SET
        description = EXCLUDED.description,
        units = EXCLUDED.units,
        unit_price_micros = EXCLUDED.unit_price_micros,
        amount_cents = EXCLUDED.amount_cents
    `,
    [
      DEMO_SECOND_DRAFT_LINE_ITEM_ID,
      DEMO_SECOND_DRAFT_INVOICE_ID,
      DEMO_SECOND_ISSUED_LINE_ITEM_ID,
      DEMO_SECOND_ISSUED_INVOICE_ID,
    ],
  );
  await client.query(
    `
      INSERT INTO audit_logs (
        id,
        actor,
        action,
        entity_type,
        entity_id,
        before_value,
        after_value,
        reason
      )
      VALUES (
        $1,
        'seed-script',
        'invoice.generated',
        'invoice',
        $2,
        NULL,
        '{"status":"issued","total_cents":6500}'::jsonb,
        'Seeded second demo customer invoice'
      )
      ON CONFLICT (id) DO NOTHING
    `,
    [DEMO_SECOND_AUDIT_LOG_ID, DEMO_SECOND_ISSUED_INVOICE_ID],
  );
}

async function main() {
  const result = await seedDemoData();

  console.log("Seeded demo data.");
  console.log(`Demo customer id: ${DEMO_CUSTOMER_ID}`);
  console.log(`Demo api key id: ${DEMO_API_KEY_ID}`);
  console.log(`Demo usage events inserted: ${result.usageEventsInserted}`);
  if (result.apiKeyToken) {
    console.log(`Demo API key token: ${result.apiKeyToken}`);
    console.log("The raw demo API key is only printed on first insert.");
  } else {
    console.log("Demo API key already exists; raw token was not printed.");
  }
  console.log(`Second demo customer id: ${DEMO_SECOND_CUSTOMER_ID}`);
  console.log(`Second demo api key id: ${DEMO_SECOND_API_KEY_ID}`);
  if (result.secondApiKeyToken) {
    console.log(`Second demo API key token: ${result.secondApiKeyToken}`);
    console.log("The second raw demo API key is only printed on first insert.");
  } else {
    console.log("Second demo API key already exists; raw token was not printed.");
  }
}

if (process.env.NODE_ENV !== "test" && isDirectScript("seed.ts")) {
  main()
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => {
      void closePool();
    });
}

function isDirectScript(scriptName: string) {
  return process.argv[1]?.endsWith(scriptName) ?? false;
}
