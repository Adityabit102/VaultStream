'use client';
import AlertCard from './AlertCard';

export type AlertType = {
  id: string;
  transaction_id: string;
  entity_id: string;
  risk_score: number;
  risk_label: 'SAFE' | 'SUSPICIOUS' | 'FRAUD';
  feature_vector: number[];
  feature_json?: {
    tx_count_5m?: number;
    tx_count_1h?: number;
    tx_count_24h?: number;
    sum_amount_1h?: number;
    device_shift?: number;
  };
  timestamp?: number;
  created_at?: string;
  action_taken?: string;
  shap_json?: Record<string, number | string> | null;
  status?: string | null;
  assignee?: string | null;
};

export default function ThreatTicker({ 
  alerts, 
  onSelectAlert, 
  selectedAlertId 
}: { 
  alerts: AlertType[]; 
  onSelectAlert: (alert: AlertType) => void;
  selectedAlertId?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', flex: 1, paddingRight: 4 }}>
      {alerts.length === 0 ? (
        <div style={{ padding: '24px 16px', borderRadius: 16, border: '1px dashed var(--color-line-strong)', background: 'var(--color-surface-2)', textAlign: 'center' }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Waiting for stream</div>
          <div style={{ fontSize: 13, color: 'var(--color-ink-faint)' }}>Inject a transaction to see live scoring.</div>
        </div>
      ) : (
        alerts.map((alert) => (
          <AlertCard 
            key={`${alert.id}-${alert.timestamp || 0}`} 
            alert={alert} 
            isActive={alert.id === selectedAlertId}
            onClick={() => onSelectAlert(alert)} 
          />
        ))
      )}
    </div>
  );
}
