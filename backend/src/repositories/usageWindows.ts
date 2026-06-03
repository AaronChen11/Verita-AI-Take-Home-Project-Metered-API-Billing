import type { Pool } from "pg";

export type UsageWindowAggregationRange = {
  start: Date;
  end: Date;
};

export type UsageWindowAggregationResult = {
  windowsUpserted: number;
};

export type UsageWindowRepository = {
  recomputeFromEvents(range: UsageWindowAggregationRange): Promise<UsageWindowAggregationResult>;
};

export class PostgresUsageWindowRepository implements UsageWindowRepository {
  constructor(private readonly pool: Pool) {}

  async recomputeFromEvents(range: UsageWindowAggregationRange) {
    // Recompute derived windows from raw events so reruns cannot double-count.
    const result = await this.pool.query(
      `
        INSERT INTO usage_windows (customer_id, window_start, window_end, total_units, updated_at)
        SELECT
          customer_id,
          date_trunc('hour', occurred_at) AS window_start,
          date_trunc('hour', occurred_at) + interval '1 hour' AS window_end,
          SUM(units)::integer AS total_units,
          now() AS updated_at
        FROM usage_events
        WHERE occurred_at >= $1
          AND occurred_at < $2
        GROUP BY customer_id, date_trunc('hour', occurred_at)
        ON CONFLICT (customer_id, window_start)
        DO UPDATE SET
          window_end = EXCLUDED.window_end,
          total_units = EXCLUDED.total_units,
          updated_at = now()
        RETURNING id
      `,
      [range.start, range.end],
    );

    return {
      windowsUpserted: result.rowCount ?? result.rows.length,
    };
  }
}
