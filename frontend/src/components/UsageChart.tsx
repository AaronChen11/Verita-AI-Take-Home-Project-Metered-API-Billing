import type { UsageBucket, UsageGranularity } from '../lib/api'
import { formatDate } from '../lib/api'

type UsageChartProps = {
  buckets: UsageBucket[]
  granularity: UsageGranularity
}

export function UsageChart({ buckets, granularity }: UsageChartProps) {
  const maxUnits = Math.max(...buckets.map((bucket) => bucket.total_units), 1)
  const totalUnits = buckets.reduce((sum, bucket) => sum + bucket.total_units, 0)

  if (buckets.length === 0) {
    return (
      <section className="panel chart-panel">
        <div>
          <p className="eyebrow">Usage</p>
          <h2>No usage yet</h2>
        </div>
        <p className="muted">Ingest events, run aggregation, then refresh this dashboard.</p>
      </section>
    )
  }

  return (
    <section className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Last 7 days</p>
          <h2>{totalUnits.toLocaleString()} billable units</h2>
        </div>
        <span className="pill">{granularity}</span>
      </div>
      <div className="usage-bars" aria-label="Usage chart">
        {buckets.map((bucket) => (
          <div className="usage-bar" key={bucket.bucket_start}>
            <span
              style={{
                height: `${Math.max((bucket.total_units / maxUnits) * 100, 4)}%`,
              }}
              title={`${bucket.total_units.toLocaleString()} units`}
            />
          </div>
        ))}
      </div>
      <div className="chart-axis">
        <span>{formatDate(buckets[0]?.bucket_start ?? '')}</span>
        <span>{formatDate(buckets[buckets.length - 1]?.bucket_start ?? '')}</span>
      </div>
    </section>
  )
}
