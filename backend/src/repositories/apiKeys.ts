import type { Pool } from "pg";

import type { ActiveApiKeyRecord, ApiKeyLookup } from "../auth/customerAuth.js";

export type ApiKeyOwnershipLookup = {
  findActiveIdsForCustomer(customerId: string, apiKeyIds: readonly string[]): Promise<Set<string>>;
};

export class PostgresApiKeyRepository implements ApiKeyLookup, ApiKeyOwnershipLookup {
  constructor(private readonly pool: Pool) {}

  async findActiveByHash(keyHash: string): Promise<ActiveApiKeyRecord | undefined> {
    const result = await this.pool.query<{ id: string; customer_id: string }>(
      `
        SELECT id, customer_id
        FROM api_keys
        WHERE key_hash = $1
          AND revoked_at IS NULL
        LIMIT 1
      `,
      [keyHash],
    );

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      customerId: row.customer_id,
    };
  }

  async findActiveIdsForCustomer(customerId: string, apiKeyIds: readonly string[]) {
    if (apiKeyIds.length === 0) {
      return new Set<string>();
    }

    const result = await this.pool.query<{ id: string }>(
      `
        SELECT id
        FROM api_keys
        WHERE customer_id = $1
          AND id = ANY($2::uuid[])
          AND revoked_at IS NULL
      `,
      [customerId, apiKeyIds],
    );

    return new Set(result.rows.map((row) => row.id));
  }
}
