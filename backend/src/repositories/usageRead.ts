import type { Pool } from "pg";

export type UsageGranularity = "hour" | "day";

export type UsageBucket = {
  bucketStart: Date;
  bucketEnd: Date;
  totalUnits: number;
};

export type UsageReadQuery = {
  customerId: string;
  start: Date;
  end: Date;
  granularity: UsageGranularity;
  limit: number;
  cursorStart?: Date;
  apiKeyId?: string;
};

export type UsageReadRepository = {
  listBuckets(query: UsageReadQuery): Promise<UsageBucket[]>;
};

export class PostgresUsageReadRepository implements UsageReadRepository {
  constructor(private readonly pool: Pool) {}

  async listBuckets(query: UsageReadQuery) {
    if (query.apiKeyId) {
      return this.listBucketsFromEvents(query);
    }

    return this.listBucketsFromWindows(query);
  }

  private async listBucketsFromWindows(query: UsageReadQuery) {
    const bucketExpression = query.granularity === "day" ? "date_trunc('day', window_start)" : "window_start";
    const bucketEndExpression =
      query.granularity === "day" ? "date_trunc('day', window_start) + interval '1 day'" : "window_end";
    const cursorFilter = query.cursorStart ? "AND bucket_start > $4" : "";
    const values = query.cursorStart
      ? [query.customerId, query.start, query.end, query.cursorStart, query.limit]
      : [query.customerId, query.start, query.end, query.limit];
    const limitParam = query.cursorStart ? "$5" : "$4";

    const result = await this.pool.query<UsageBucketRow>(
      `
        SELECT bucket_start, bucket_end, SUM(total_units)::integer AS total_units
        FROM (
          SELECT
            ${bucketExpression} AS bucket_start,
            ${bucketEndExpression} AS bucket_end,
            total_units
          FROM usage_windows
          WHERE customer_id = $1
            AND window_start >= $2
            AND window_start < $3
        ) buckets
        WHERE true
          ${cursorFilter}
        GROUP BY bucket_start, bucket_end
        ORDER BY bucket_start ASC
        LIMIT ${limitParam}
      `,
      values,
    );

    return result.rows.map(toUsageBucket);
  }

  private async listBucketsFromEvents(query: UsageReadQuery) {
    const bucketExpression =
      query.granularity === "day" ? "date_trunc('day', occurred_at)" : "date_trunc('hour', occurred_at)";
    const bucketEndInterval = query.granularity === "day" ? "interval '1 day'" : "interval '1 hour'";
    const cursorFilter = query.cursorStart ? "AND bucket_start > $5" : "";
    const values = query.cursorStart
      ? [query.customerId, query.apiKeyId, query.start, query.end, query.cursorStart, query.limit]
      : [query.customerId, query.apiKeyId, query.start, query.end, query.limit];
    const limitParam = query.cursorStart ? "$6" : "$5";

    const result = await this.pool.query<UsageBucketRow>(
      `
        SELECT
          bucket_start,
          bucket_start + ${bucketEndInterval} AS bucket_end,
          SUM(units)::integer AS total_units
        FROM (
          SELECT
            ${bucketExpression} AS bucket_start,
            units
          FROM usage_events
          WHERE customer_id = $1
            AND api_key_id = $2
            AND occurred_at >= $3
            AND occurred_at < $4
        ) buckets
        WHERE true
          ${cursorFilter}
        GROUP BY bucket_start
        ORDER BY bucket_start ASC
        LIMIT ${limitParam}
      `,
      values,
    );

    return result.rows.map(toUsageBucket);
  }
}

type UsageBucketRow = {
  bucket_start: Date;
  bucket_end: Date;
  total_units: number;
};

function toUsageBucket(row: UsageBucketRow): UsageBucket {
  return {
    bucketStart: row.bucket_start,
    bucketEnd: row.bucket_end,
    totalUnits: row.total_units,
  };
}
