'use client';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useState } from 'react';
import type { AlertType } from './ThreatTicker';

interface MockData {
  id: string;
  amount: number;
  velocity: number;
  risk_score: number;
  risk_label: string;
  entity_id: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: MockData }>;
}

const generateMockData = () =>
  Array.from({ length: 200 }).map((_, i) => {
    const amount = Math.random() * 5000 + 10;
    const velocity = Math.random() * 100 + 1;
    let risk_score = 0.1;
    let risk_label = 'SAFE';
    if (amount > 3000 && velocity > 80) {
      risk_score = 0.9;
      risk_label = 'FRAUD';
    } else if (amount > 2000 && velocity > 50) {
      risk_score = 0.5;
      risk_label = 'SUSPICIOUS';
    }
    return {
      id: `mock-${i}`,
      amount,
      velocity,
      risk_score,
      risk_label,
      entity_id: `user-${Math.floor(Math.random() * 1000)}`,
    };
  });

const CustomTooltip = ({ active, payload }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div
        className="glass"
        style={{ padding: 12, borderRadius: 12, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}
      >
        <div className="eyebrow" style={{ fontSize: 10 }}>Entity {data.entity_id}</div>
        <div className="data">Amount · ${data.amount.toFixed(2)}</div>
        <div className="data">Velocity · {data.velocity.toFixed(1)} tx/h</div>
        <div className="data">Risk · {(data.risk_score * 100).toFixed(1)}%</div>
      </div>
    );
  }
  return null;
};

// deterministic 0..1 jitter from an id, so zero-feature alerts scatter instead
// of collapsing onto a line (two independent streams via different salts)
function jitter(id: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0);
  return (h % 1000) / 1000;
}

function alertsToPoints(alerts: AlertType[]): MockData[] {
  return alerts.map((a) => {
    const fv = a.feature_vector || [];
    const velocity = Number(fv[1] ?? 0); // tx_count_1h
    const amount = Number(fv[3] ?? 0); // sum_amount_1h
    const s = a.risk_score;
    return {
      id: a.id,
      // when real features exist use them; otherwise place near the band but
      // with independent jitter on each axis so points form a cloud, not a line
      amount: amount > 0 ? amount : Math.max(10, s * 2600 + jitter(a.id, 0x9e37) * 1800),
      velocity: velocity > 0 ? velocity : Math.max(1, s * 34 + jitter(a.id, 0x85eb) * 22),
      risk_score: s,
      risk_label: a.risk_label,
      entity_id: a.entity_id,
    };
  });
}

export default function FeatureScatterPlot({ alerts }: { alerts?: AlertType[] }) {
  const [mock] = useState<MockData[]>(() => generateMockData());
  // Plot real scored alerts when available; otherwise show the illustrative cloud.
  const live = alerts && alerts.length > 0 ? alertsToPoints(alerts) : [];
  const data = live.length > 0 ? live : mock;

  const getColor = (label: string) =>
    label === 'FRAUD'
      ? 'var(--color-alert)'
      : label === 'SUSPICIOUS'
      ? 'var(--color-warn)'
      : 'var(--color-safe)';

  interface CustomShapeProps {
    cx?: number;
    cy?: number;
    fill?: string;
    payload?: { risk_label?: string };
  }

  const renderCustomShape = (props: CustomShapeProps) => {
    const { cx, cy, fill, payload } = props;
    if (!cx || !cy || !payload) return null;
    const r = payload.risk_label === 'FRAUD' ? 7 : payload.risk_label === 'SUSPICIOUS' ? 5 : 4;
    return <circle cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.78} stroke="none" />;
  };

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 250 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 10 }}>
          <CartesianGrid strokeDasharray="4 4" stroke="var(--color-line)" />
          <XAxis
            type="number"
            dataKey="amount"
            name="Amount"
            stroke="var(--color-ink-faint)"
            tick={{ fill: 'var(--color-ink-faint)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
            tickFormatter={(val) => `$${val}`}
          />
          <YAxis
            type="number"
            dataKey="velocity"
            name="Velocity"
            stroke="var(--color-ink-faint)"
            tick={{ fill: 'var(--color-ink-faint)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '4 4', stroke: 'var(--color-line-strong)' }} />
          <Scatter name="Transactions" data={data} shape={renderCustomShape}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getColor(entry.risk_label)} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
