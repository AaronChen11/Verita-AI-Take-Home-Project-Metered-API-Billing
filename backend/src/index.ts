import "dotenv/config";

import { createApp } from "./app.js";
import { createCustomerAuthMiddleware } from "./auth/customerAuth.js";
import { createOpsAuthMiddleware } from "./auth/opsAuth.js";
import { env } from "./config/env.js";
import { getPool } from "./db/pool.js";
import { PostgresApiKeyRepository } from "./repositories/apiKeys.js";
import { PostgresCreditRepository } from "./repositories/credits.js";
import { PostgresInvoiceRepository } from "./repositories/invoices.js";
import { PostgresLineItemOverrideRepository } from "./repositories/lineItemOverrides.js";
import { PostgresOpsReadRepository } from "./repositories/opsReads.js";
import { PostgresPaymentWebhookRepository } from "./repositories/paymentWebhooks.js";
import { PostgresUsageEventRepository } from "./repositories/usageEvents.js";
import { PostgresUsageReadRepository } from "./repositories/usageRead.js";

const pool = getPool();
const apiKeys = new PostgresApiKeyRepository(pool);
const credits = new PostgresCreditRepository(pool);
const invoices = new PostgresInvoiceRepository(pool);
const lineItemOverrides = new PostgresLineItemOverrideRepository(pool);
const opsReads = new PostgresOpsReadRepository(pool);
const payments = new PostgresPaymentWebhookRepository(pool);
const usageEvents = new PostgresUsageEventRepository(pool);
const usageRead = new PostgresUsageReadRepository(pool);

const app = createApp({
  customerApi: {
    auth: createCustomerAuthMiddleware(apiKeys, env.API_KEY_PEPPER),
    events: {
      apiKeys,
      usageEvents,
    },
    invoices: {
      invoices,
    },
    usage: {
      apiKeys,
      usageRead,
    },
  },
  paymentWebhooks: {
    payments,
    webhookSecret: env.PAYMENT_WEBHOOK_SECRET,
  },
  opsApi: {
    auth: createOpsAuthMiddleware(env.OPS_SHARED_SECRET),
    ops: {
      credits,
      lineItemOverrides,
      opsReads,
    },
  },
});

app.listen(env.PORT, () => {
  console.log(`backend listening on http://localhost:${env.PORT}`);
});
