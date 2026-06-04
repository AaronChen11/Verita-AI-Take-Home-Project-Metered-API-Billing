import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import type { UsageBucket, UsageGranularity } from '../lib/api'
import { formatDate } from '../lib/api'

type UsageChartProps = {
  buckets: UsageBucket[]
  granularity: UsageGranularity
}

type TooltipPayloadEntry = {
  value: number
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: string
}) {
  if (!active || !payload?.length) return null

  return (
    <div className="chart-tooltip">
      <span className="chart-tooltip-label">{label}</span>
      <strong className="chart-tooltip-value">{payload[0]?.value.toLocaleString()}</strong>
      <span className="chart-tooltip-unit">units</span>
    </div>
  )
}

export function UsageChart({ buckets, granularity }: UsageChartProps) {
  const totalUnits = buckets.reduce((sum, bucket) => sum + bucket.total_units, 0)

  if (buckets.length === 0) {
    return (
      <section className="panel chart-panel">
        <div>
          <p className="eyebrow">— Usage</p>
          <h2>No usage yet</h2>
        </div>
        <p className="muted">Ingest events, run aggregation, then refresh this dashboard.</p>
      </section>
    )
  }

  const data = buckets.map((bucket) => ({
    date: formatDate(bucket.bucket_start),
    units: bucket.total_units,
  }))

  return (
    <section className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">— Last 7 days</p>
          <h2>{totalUnits.toLocaleString()} billable units</h2>
        </div>
        <span className="pill">{granularity}</span>
      </div>

      <ResponsiveContainer height={220} width="100%">
        <LineChart data={data} margin={{ bottom: 0, left: 0, right: 8, top: 8 }}>
          <CartesianGrid
            stroke="rgba(28, 22, 16, 0.06)"
            strokeDasharray="4 4"
            vertical={false}
          />
          <XAxis
            axisLine={false}
            dataKey="date"
            interval="preserveStartEnd"
            tick={{ fill: 'var(--muted)', fontSize: 11, fontFamily: 'var(--sans)' }}
            tickLine={false}
          />
          <YAxis
            axisLine={false}
            tick={{ fill: 'var(--muted)', fontSize: 11, fontFamily: 'var(--sans)' }}
            tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
            tickLine={false}
            width={36}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--burgundy)', strokeWidth: 1, strokeDasharray: '4 4' }} />
          <Line
            activeDot={{ fill: 'var(--burgundy)', r: 5, strokeWidth: 0 }}
            dataKey="units"
            dot={false}
            stroke="var(--burgundy)"
            strokeWidth={2}
            type="monotone"
          />
        </LineChart>
      </ResponsiveContainer>
    </section>
  )
}
