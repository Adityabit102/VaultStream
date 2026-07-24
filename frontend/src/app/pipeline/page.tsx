'use client';
import { motion } from 'framer-motion';
import PageShell, { PageHeading } from '@/components/site/PageShell';

/**
 * Batch pipeline showcase — a STATIC, self-contained documentation page for the
 * PySpark/Databricks Medallion extension (see /batch_pipeline). It makes no API
 * calls and imports nothing new, so it is fully deploy-safe. Numbers shown are a
 * representative snapshot of a sample pipeline run, clearly labelled as such.
 */

interface Layer {
  key: string;
  name: string;
  tables: string[];
  blurb: string;
}

const LAYERS: Layer[] = [
  {
    key: 'bronze',
    name: 'Bronze · raw',
    tables: ['bronze/transactions', 'bronze/identity'],
    blurb: 'Land the historical IEEE-CIS CSVs exactly as received — append-only, no typing. Adds lineage columns (ingest timestamp, source file, checksum).',
  },
  {
    key: 'silver',
    name: 'Silver · cleaned',
    tables: ['silver/transactions_cleaned', 'silver/dq_report'],
    blurb: 'Type-enforce, dedup on transaction id, join identity (orphans flagged not dropped), derive canonical account / device / merchant. Runs the DQ gate.',
  },
  {
    key: 'gold',
    name: 'Gold · features',
    tables: ['gold/fact_transactions', 'gold/dim_account', 'gold/dim_device', 'gold/dim_date'],
    blurb: 'Recompute the same 8 behavioural features the live model scores — over full history, via Spark window functions — in a Kimball star schema.',
  },
  {
    key: 'export',
    name: 'Export · retrain',
    tables: ['export/model_lab_training'],
    blurb: 'Column-matched to the Model Lab schema (FEATURE_NAMES + isFraud), so it drops into champion/challenger retraining with no Model Lab code changes.',
  },
];

const PARITY: { rt: string; batch: string }[] = [
  { rt: 'tx_count_5m / 1h / 24h TTL counters', batch: 'count over rangeBetween windows on event time' },
  { rt: 'sum_amount_1h → avg_amount_1h', batch: 'sum over 1h range window ÷ tx_count_1h' },
  { rt: 'unique-merchant zset (1h)', batch: 'size(collect_set(merchant)) over 1h window' },
  { rt: 'device-shift (last-device compare)', batch: 'lag(device_id) over account, time-ordered' },
  { rt: "Welford online amount z-score", batch: 'expanding sample mean / std, time-ordered' },
];

// Representative snapshot of a sample run's silver/dq_report (illustrative).
const DQ_SNAPSHOT = {
  batch_id: '20260724T101200Z',
  passed: true,
  bronze_rows: 5012,
  silver_rows: 4998,
  rowcount_shrink_rate: 0.0028,
  duplicate_rate: 0.0016,
  orphan_identity_rows: 3,
  checks: [
    { name: 'Null-rate · critical columns', detail: 'TransactionID, TransactionAmt, TransactionDT, card1', ok: true },
    { name: 'Duplicate-rate · transaction id', detail: '0.16% ≤ 1.0% bound', ok: true },
    { name: 'Row-count reconciliation', detail: '0.28% shrink ≤ 15% bound (drops logged)', ok: true },
    { name: 'Schema-drift vs Bronze', detail: 'no new / missing columns', ok: true },
  ],
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="lux-card" style={{ padding: '14px 16px' }}>
      <div className="data" style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-ink)' }}>{value}</div>
      <div className="eyebrow" style={{ fontSize: 9, marginTop: 4 }}>{label}</div>
    </div>
  );
}

export default function PipelinePage() {
  return (
    <PageShell maxWidth={1080}>
      <PageHeading
        eyebrow="Data Engineering"
        title="Batch feature pipeline"
        subtitle="A standalone PySpark / Databricks Medallion path that backfills the same fraud features over full history for model retraining — running alongside the real-time Kafka path, without touching it."
        action={
          <div className="badge badge-neutral" style={{ fontSize: 11, padding: '8px 14px' }}>
            Bronze → Silver → Gold · Delta Lake
          </div>
        }
      />

      {/* Medallion flow */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14, marginBottom: 28 }}>
        {LAYERS.map((l, i) => (
          <motion.div
            key={l.key}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            className="lux-card"
            style={{ padding: '20px 20px 18px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{
                width: 30, height: 30, borderRadius: 10, flexShrink: 0,
                background: 'var(--grad-violet-rose)', color: '#fff',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14,
              }}>{i + 1}</span>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16 }}>{l.name}</div>
            </div>
            <p style={{ fontSize: 13, color: 'var(--color-ink-soft)', lineHeight: 1.55, marginBottom: 12 }}>{l.blurb}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {l.tables.map((t) => (
                <span key={t} className="data" style={{
                  fontSize: 10.5, padding: '3px 8px', borderRadius: 999,
                  background: 'var(--color-surface-2)', color: 'var(--color-ink-soft)',
                  border: '1px solid var(--color-line)',
                }}>{t}</span>
              ))}
            </div>
          </motion.div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        {/* Feature parity */}
        <div className="lux-card" style={{ padding: 24 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Same logic, two paradigms</div>
          <h2 style={{ fontSize: 20, marginBottom: 16 }}>Feature parity</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {PARITY.map((p) => (
              <div key={p.rt} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--color-ink-soft)', textAlign: 'right' }}>{p.rt}</span>
                <span style={{ color: 'var(--color-violet)', fontSize: 13 }}>→</span>
                <span className="data" style={{ fontSize: 11.5, color: 'var(--color-ink)' }}>{p.batch}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-ink-faint)', lineHeight: 1.55, marginTop: 16 }}>
            The z-score parity is pinned numerically by a test that runs without Spark: Welford&apos;s online
            update equals the batch expanding aggregation, to floating-point tolerance.
          </p>
        </div>

        {/* DQ report */}
        <div className="lux-card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div className="eyebrow">Data quality gate · sample run</div>
            <span className={`badge badge-${DQ_SNAPSHOT.passed ? 'safe' : 'alert'}`} style={{ fontSize: 10 }}>
              {DQ_SNAPSHOT.passed ? 'PASSED' : 'FAILED'}
            </span>
          </div>
          <h2 style={{ fontSize: 20, marginBottom: 16 }}>silver/dq_report</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
            <Stat label="Bronze in" value={DQ_SNAPSHOT.bronze_rows.toLocaleString()} />
            <Stat label="Silver out" value={DQ_SNAPSHOT.silver_rows.toLocaleString()} />
            <Stat label="Orphans" value={String(DQ_SNAPSHOT.orphan_identity_rows)} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {DQ_SNAPSHOT.checks.map((c) => (
              <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  width: 9, height: 9, borderRadius: 999, flexShrink: 0,
                  background: c.ok ? 'var(--color-safe)' : 'var(--color-alert)',
                  boxShadow: `0 0 0 3px ${c.ok ? 'var(--color-safe-soft)' : 'var(--color-alert-soft)'}`,
                }} />
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{c.name}</div>
                  <div className="data" style={{ fontSize: 11, color: 'var(--color-ink-faint)' }}>{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="lux-card" style={{ padding: '18px 24px', marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15 }}>Only touchpoint: the Model Lab</div>
          <p style={{ fontSize: 12.5, color: 'var(--color-ink-soft)', marginTop: 4, maxWidth: 620, lineHeight: 1.55 }}>
            The Gold export is a drop-in, versioned retraining source for the existing champion/challenger flow.
            Nothing upstream of that changes — real-time scoring, Kafka, Redis, and the live model are untouched.
          </p>
        </div>
        <span className="data" style={{ fontSize: 11, color: 'var(--color-ink-faint)', whiteSpace: 'nowrap' }}>
          batch_pipeline/ · own deps · never imported by the API
        </span>
      </div>
    </PageShell>
  );
}
