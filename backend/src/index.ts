import "dotenv/config";

import { createApp } from "./app.js";
import { createCustomerAuthMiddleware } from "./auth/customerAuth.js";
import { env } from "./config/env.js";
import { getPool } from "./db/pool.js";
import { PostgresApiKeyRepository } from "./repositories/apiKeys.js";
import { PostgresInvoiceRepository } from "./repositories/invoices.js";
import { PostgresPaymentWebhookRepository } from "./repositories/paymentWebhooks.js";
import { PostgresUsageEventRepository } from "./repositories/usageEvents.js";
import { PostgresUsageReadRepository } from "./repositories/usageRead.js";

const pool = getPool();
const apiKeys = new PostgresApiKeyRepository(pool);
const invoices = new PostgresInvoiceRepository(pool);
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
});

app.listen(env.PORT, () => {
  console.log(`backend listening on http://localhost:${env.PORT}`);
});
