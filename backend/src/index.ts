import "dotenv/config";

import { createApp } from "./app.js";
import { createCustomerAuthMiddleware } from "./auth/customerAuth.js";
import { env } from "./config/env.js";
import { getPool } from "./db/pool.js";
import { PostgresApiKeyRepository } from "./repositories/apiKeys.js";
import { PostgresUsageEventRepository } from "./repositories/usageEvents.js";
import { PostgresUsageReadRepository } from "./repositories/usageRead.js";

const pool = getPool();
const apiKeys = new PostgresApiKeyRepository(pool);
const usageEvents = new PostgresUsageEventRepository(pool);
const usageRead = new PostgresUsageReadRepository(pool);

const app = createApp({
  customerApi: {
    auth: createCustomerAuthMiddleware(apiKeys, env.API_KEY_PEPPER),
    events: {
      apiKeys,
      usageEvents,
    },
    usage: {
      apiKeys,
      usageRead,
    },
  },
});

app.listen(env.PORT, () => {
  console.log(`backend listening on http://localhost:${env.PORT}`);
});
