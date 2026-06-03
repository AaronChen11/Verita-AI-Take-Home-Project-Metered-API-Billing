import type { Pool, PoolClient } from "pg";

export type PaidInvoiceWebhookInput = {
  providerEventId: string;
  invoiceId: string;
  eventType: string;
  payload: unknown;
  paidAt: Date;
};

export type PaidInvoiceWebhookResult = {
  duplicate: boolean;
  invoiceId: string;
};

export type PaymentWebhookRepository = {
  processPaidInvoice(input: PaidInvoiceWebhookInput): Promise<PaidInvoiceWebhookResult>;
};

export class PaymentWebhookInvoiceNotFoundError extends Error {
  constructor(invoiceId: string) {
    super(`Invoice not found for payment webhook: ${invoiceId}`);
  }
}

export class PostgresPaymentWebhookRepository implements PaymentWebhookRepository {
  constructor(private readonly pool: Pool) {}

  async processPaidInvoice(input: PaidInvoiceWebhookInput) {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const delivery = await insertWebhookDelivery(client, input);

      if (!delivery) {
        await client.query("ROLLBACK");
        return { duplicate: true, invoiceId: input.invoiceId };
      }

      await markInvoicePaid(client, input.invoiceId, input.paidAt);
      await markWebhookProcessed(client, delivery.id);
      await client.query("COMMIT");

      return { duplicate: false, invoiceId: input.invoiceId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function insertWebhookDelivery(client: PoolClient, input: PaidInvoiceWebhookInput) {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO webhook_deliveries (
        provider_event_id,
        invoice_id,
        event_type,
        payload
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (provider_event_id) DO NOTHING
      RETURNING id
    `,
    [input.providerEventId, input.invoiceId, input.eventType, input.payload],
  );

  return result.rows[0];
}

async function markInvoicePaid(client: PoolClient, invoiceId: string, paidAt: Date) {
  const result = await client.query<{ id: string }>(
    `
      UPDATE invoices
      SET
        status = 'paid',
        paid_at = COALESCE(paid_at, $2)
      WHERE id = $1
        AND status != 'void'
      RETURNING id
    `,
    [invoiceId, paidAt],
  );

  if (!result.rows[0]) {
    throw new PaymentWebhookInvoiceNotFoundError(invoiceId);
  }
}

async function markWebhookProcessed(client: PoolClient, deliveryId: string) {
  await client.query(
    `
      UPDATE webhook_deliveries
      SET processed_at = now()
      WHERE id = $1
    `,
    [deliveryId],
  );
}
