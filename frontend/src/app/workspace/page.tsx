'use client';
import ThreatTicker, { AlertType } from '@/components/ThreatTicker';
import DeepDivePanel from '@/components/DeepDivePanel';
import FeatureScatterPlot from '@/components/FeatureScatterPlot';
import DynamicFooter from '@/components/DynamicFooter';
import WorkspaceHeader from '@/components/site/WorkspaceHeader';
import AppBackground from '@/components/site/AppBackground';
import { Skeleton } from '@/components/ui';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/components/AuthProvider';
import { useRole } from '@/components/RoleProvider';
import { useNotifications } from '@/components/NotificationProvider';
import { apiUrl, getToken, WS_BASE } from '@/lib/api';
import { takeAction } from '@/app/actions';

const PAGE = 50;

export default function Workspace() {
  const { user, isMock } = useAuth();
  const { isAdmin } = useRole();
  const { push: pushNotification } = useNotifications();
  const [modelHash, setModelHash] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<AlertType | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [offset, setOffset] = useState(PAGE);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const notifyRef = useRef(pushNotification);
  useEffect(() => { notifyRef.current = pushNotification; }, [pushNotification]);

  const [toast, setToast] = useState<{ message: string; type: 'safe' | 'warn' | 'alert' } | null>(null);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isCustomSimOpen, setIsCustomSimOpen] = useState(false);
  const [simEntityId, setSimEntityId] = useState('user_pitch_1');
  const [simAmount, setSimAmount] = useState('250.00');
  const [simDeviceShift, setSimDeviceShift] = useState('0');
  const [simTx5m, setSimTx5m] = useState('1');
  const [simTx1h, setSimTx1h] = useState('3');
  const [simTx24h, setSimTx24h] = useState('10');
  const [simDeviceFp, setSimDeviceFp] = useState('dev_pitch_device');

  // Stream controls + triage prefs (persisted)
  const [streaming, setStreaming] = useState(false);
  const [streamSource, setStreamSource] = useState<'mock' | 'replay'>('mock');
  const [filter, setFilter] = useState<'ALL' | 'SAFE' | 'SUSPICIOUS' | 'FRAUD'>('ALL');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'time' | 'risk'>('time');
  const [paused, setPaused] = useState(false);
  const [frozenList, setFrozenList] = useState<AlertType[] | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [wsState, setWsState] = useState<'connecting' | 'open' | 'reconnecting'>('connecting');
  const prefsLoaded = useRef(false);

  // Restore preferences (one-time on mount).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem('vs_ws_prefs') || '{}');
      if (p.filter) setFilter(p.filter);
      if (p.sortBy) setSortBy(p.sortBy);
      if (p.streamSource) setStreamSource(p.streamSource);
      if (typeof p.soundOn === 'boolean') setSoundOn(p.soundOn);
    } catch { /* ignore */ }
    prefsLoaded.current = true;
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  // Persist preferences
  useEffect(() => {
    if (!prefsLoaded.current) return;
    localStorage.setItem('vs_ws_prefs', JSON.stringify({ filter, sortBy, streamSource, soundOn }));
  }, [filter, sortBy, streamSource, soundOn]);

  const ping = useCallback(() => {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 660; o.type = 'sine';
      g.gain.setValueAtTime(0.06, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.26);
    } catch { /* ignore */ }
  }, []);
  const soundRef = useRef(soundOn);
  useEffect(() => { soundRef.current = soundOn; }, [soundOn]);

  useEffect(() => {
    let active = true;
    let retry: ReturnType<typeof setTimeout>;
    const initConnection = async () => {
      const token = await getToken(user?.role || 'viewer');
      if (!active) return;

      try {
        const res = await fetch(apiUrl(`/v1/alerts?limit=${PAGE}&offset=0`), { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (active && Array.isArray(data)) {
          setAlerts(data);
          setHasMore(data.length === PAGE);
          setOffset(PAGE);
        }
      } catch (err) {
        console.error('Failed to fetch initial alerts', err);
      } finally {
        if (active) setLoadingInitial(false);
      }
      if (!active) return;

      const connect = () => {
        if (!active) return;
        setWsState((s) => (s === 'open' ? 'reconnecting' : s));
        const sock = new WebSocket(`${WS_BASE}?token=${token}`);
        ws.current = sock;
        sock.onopen = () => active && setWsState('open');
        sock.onclose = () => {
          if (!active) return;
          setWsState('reconnecting');
          retry = setTimeout(connect, 2500);
        };
        sock.onmessage = (event) => {
          try {
            const newAlert = JSON.parse(event.data);
            if (newAlert.error || !newAlert.id || !newAlert.risk_label) return;
            newAlert.timestamp = Date.now();
            if (!active) return;
            if (newAlert.risk_label === 'FRAUD' && soundRef.current) ping();
            if (newAlert.risk_label === 'FRAUD' || newAlert.risk_label === 'SUSPICIOUS') {
              notifyRef.current({ id: String(newAlert.id), entity_id: String(newAlert.entity_id ?? ''), transaction_id: String(newAlert.transaction_id ?? ''), risk_score: Number(newAlert.risk_score ?? 0), risk_label: String(newAlert.risk_label) });
            }
            setAlerts((prev) => (prev.some((a) => a.id === newAlert.id) ? prev : [newAlert, ...prev].slice(0, 50)));
          } catch (err) {
            console.error('Failed to parse alert', err);
          }
        };
      };
      connect();
    };
    initConnection();
    return () => {
      active = false;
      clearTimeout(retry);
      ws.current?.close();
    };
  }, [isMock, user?.role, ping]);

  useEffect(() => {
    if (!isAdmin) return;
    const fetchModelHealth = async () => {
      const token = await getToken('admin');
      try {
        const res = await fetch(apiUrl('/v1/model/health'), { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data = await res.json();
          setModelHash(data.model_hash);
        }
      } catch (e) {
        console.error('Failed to fetch model health:', e);
      }
    };
    fetchModelHealth();
  }, [isAdmin, isMock]);

  const showToast = (message: string, type: 'safe' | 'warn' | 'alert') => {
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    setToast({ message, type });
    toastTimeout.current = setTimeout(() => setToast(null), 4500);
  };

  const handleActionSuccess = (alertId: string, action: 'freeze' | 'escalate') => {
    setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, action_taken: action } : a)));
    setSelectedAlert((prev) => (prev && prev.id === alertId ? { ...prev, action_taken: action } : prev));
  };

  // Displayed alerts: verdict filter → search → sort → freeze when paused.
  const filtered = filter === 'ALL' ? alerts : alerts.filter((a) => a.risk_label === filter);
  const searched = search.trim()
    ? filtered.filter((a) => `${a.entity_id} ${a.transaction_id}`.toLowerCase().includes(search.trim().toLowerCase()))
    : filtered;
  const sorted = useMemo(() => {
    const arr = [...searched];
    if (sortBy === 'risk') arr.sort((a, b) => b.risk_score - a.risk_score);
    return arr;
  }, [searched, sortBy]);
  const displayedAlerts = paused && frozenList ? frozenList : sorted;
  const togglePause = () => {
    setFrozenList(paused ? null : sorted);
    setPaused((p) => !p);
  };

  // Keyboard shortcuts: ↑/↓ move selection, F freeze, E escalate.
  const quickAction = useCallback(async (action: 'freeze' | 'escalate') => {
    if (!user || !selectedAlert || selectedAlert.action_taken) return;
    const analyst = user.role === 'analyst' || user.role === 'admin';
    // freeze: analyst+; escalate: analyst+, or viewer on suspicious/fraud
    if (action === 'freeze' && !analyst) return;
    if (action === 'escalate' && !analyst &&
        !(user.role === 'viewer' && (selectedAlert.risk_label === 'SUSPICIOUS' || selectedAlert.risk_label === 'FRAUD'))) return;
    const token = await getToken(user.role);
    const res = await takeAction(selectedAlert.id, action, token, user.email);
    if (res?.success) handleActionSuccess(selectedAlert.id, action);
  }, [user, selectedAlert]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const list = displayedAlerts;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (list.length === 0) return;
        const idx = selectedAlert ? list.findIndex((a) => a.id === selectedAlert.id) : -1;
        const next = e.key === 'ArrowDown' ? Math.min(idx + 1, list.length - 1) : Math.max(idx - 1, 0);
        setSelectedAlert(list[next < 0 ? 0 : next]);
      } else if (e.key.toLowerCase() === 'f') {
        quickAction('freeze');
      } else if (e.key.toLowerCase() === 'e') {
        quickAction('escalate');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [displayedAlerts, selectedAlert, quickAction]);

  // Optimistically add a scored alert returned by the backend (WS dedupes by id).
  const addAlert = (data: Record<string, unknown>, entityId: string) => {
    if (!data || !data.id || !data.risk_label) return;
    const alert = {
      id: String(data.id),
      transaction_id: String(data.transaction_id ?? ''),
      entity_id: entityId,
      risk_score: Number(data.risk_score ?? 0),
      risk_label: data.risk_label as AlertType['risk_label'],
      feature_vector: (data.feature_vector as number[]) ?? [0, 0, 0, 0, 0],
      rules_triggered: (data.rules_triggered as string[]) ?? [],
      timestamp: Date.now(),
    };
    if (alert.risk_label === 'FRAUD' || alert.risk_label === 'SUSPICIOUS') {
      notifyRef.current({ id: alert.id, entity_id: alert.entity_id, transaction_id: alert.transaction_id, risk_score: alert.risk_score, risk_label: alert.risk_label });
    }
    setAlerts((prev) => (prev.some((a) => a.id === alert.id) ? prev : [alert, ...prev].slice(0, 50)));
  };

  // Load older persisted alerts (pagination). Appends and de-dupes by id.
  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const token = await getToken(user?.role || 'viewer');
      const res = await fetch(apiUrl(`/v1/alerts?limit=${PAGE}&offset=${offset}`), { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (Array.isArray(data)) {
        setAlerts((prev) => {
          const seen = new Set(prev.map((a) => a.id));
          return [...prev, ...data.filter((a: AlertType) => !seen.has(a.id))];
        });
        setHasMore(data.length === PAGE);
        setOffset((o) => o + PAGE);
      }
    } catch (e) { console.error('Load more failed', e); }
    setLoadingMore(false);
  };

  // Download the full transactions/alerts history as CSV from the backend.
  const exportCsv = async () => {
    const token = await getToken(user?.role || 'viewer');
    const res = await fetch(apiUrl('/v1/alerts/export'), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { showToast('Export failed', 'alert'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'vaultstream-transactions.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const inject = async (opts: {
    entityId: string;
    amount: number;
    merchantId: string;
    deviceFp: string;
    profile?: 'safe' | 'suspicious' | 'fraud';
    override?: Record<string, number>;
    toast?: boolean;
  }) => {
    const transactionId = `tx_${(opts.profile ?? 'custom')}_${Math.floor(Math.random() * 100000)}`;
    try {
      const response = await fetch(apiUrl('/v1/ingest'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: transactionId,
          entity_id: opts.entityId,
          amount: parseFloat(opts.amount.toFixed(2)),
          merchant_id: opts.merchantId,
          device_fingerprint: opts.deviceFp,
          timestamp: new Date().toISOString(),
          ...(opts.profile ? { profile: opts.profile } : {}),
          ...(opts.override ? { override_features: opts.override } : {}),
        }),
      });
      const data = await response.json();
      addAlert(data, opts.entityId);
      if (opts.toast && data.risk_label) {
        const type = data.risk_label === 'FRAUD' ? 'alert' : data.risk_label === 'SUSPICIOUS' ? 'warn' : 'safe';
        showToast(`${data.risk_label} · score ${(data.risk_score * 100).toFixed(1)}%`, type);
      }
      return data;
    } catch {
      if (opts.toast) showToast('Injection failed', 'alert');
    }
  };

  const triggerSimulation = (isFraud: boolean) =>
    inject({
      entityId: `user_${Math.floor(Math.random() * 9000 + 1000)}`,
      amount: isFraud ? Math.random() * 5000 + 5000 : Math.random() * 100 + 10,
      merchantId: isFraud ? 'merch_luxury_watches' : 'merch_coffee',
      deviceFp: isFraud ? `dev_hacker_${Math.floor(Math.random() * 1000)}` : `dev_user_${Math.floor(Math.random() * 1000)}`,
      profile: isFraud ? 'fraud' : 'safe',
      toast: true,
    });

  const handleCustomSimSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCustomSimOpen(false);
    await inject({
      entityId: simEntityId,
      amount: parseFloat(simAmount),
      merchantId: parseFloat(simAmount) > 1000 ? 'merch_luxury_watches' : 'merch_custom',
      deviceFp: simDeviceFp,
      override: {
        tx_count_5m: parseInt(simTx5m),
        tx_count_1h: parseInt(simTx1h),
        tx_count_24h: parseInt(simTx24h),
        sum_amount_1h: parseFloat(simAmount),
        device_shift: parseInt(simDeviceShift),
      },
      toast: true,
    });
  };

  // Stream driver: 'mock' continuously injects scored transactions; 'replay'
  // re-emits persisted alerts from the database as a live stream.
  useEffect(() => {
    if (!streaming) return;
    let cancelled = false;

    if (streamSource === 'mock') {
      const pick = (): 'safe' | 'suspicious' | 'fraud' => {
        const r = Math.random();
        return r < 0.6 ? 'safe' : r < 0.85 ? 'suspicious' : 'fraud';
      };
      const fire = () => {
        const profile = pick();
        inject({
          entityId: `user_${Math.floor(Math.random() * 9000 + 1000)}`,
          amount: profile === 'fraud' ? Math.random() * 6000 + 3000 : profile === 'suspicious' ? Math.random() * 700 + 150 : Math.random() * 120 + 8,
          merchantId: profile === 'fraud' ? 'merch_luxury_watches' : 'merch_retail',
          deviceFp: `dev_${Math.floor(Math.random() * 9999)}`,
          profile,
        });
      };
      fire();
      const t = setInterval(fire, 1500);
      return () => clearInterval(t);
    }

    // replay from DB
    (async () => {
      const token = await getToken(user?.role || 'viewer');
      const res = await fetch(apiUrl('/v1/alerts'), { headers: { Authorization: `Bearer ${token}` } });
      const stored: AlertType[] = res.ok ? await res.json() : [];
      if (cancelled || stored.length === 0) return;
      const ordered = [...stored].reverse(); // oldest first → stream forward
      setAlerts([]);
      let i = 0;
      const t = setInterval(() => {
        if (cancelled) return;
        const a = ordered[i % ordered.length];
        setAlerts((prev) => [{ ...a, timestamp: Date.now() }, ...prev.filter((p) => p.id !== a.id)].slice(0, 50));
        i += 1;
        if (i >= ordered.length) clearInterval(t);
      }, 1200);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, streamSource]);

  const panelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--color-surface)',
    border: '1px solid var(--color-line)',
    borderRadius: 24,
    padding: 20,
    boxShadow: 'var(--shadow-sm)',
    minHeight: 0,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: 16, gap: 14 }}>
      <AppBackground />
      <WorkspaceHeader modelHash={isAdmin ? modelHash : null} />

      <main style={{ flex: 1, display: 'grid', gridTemplateColumns: '300px 1fr 380px', gap: 14, minHeight: 0 }} className="ws-grid">
        {/* Left: live threats + simulator */}
        <section style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 16 }}>Live threats</h2>
            <span className="data" style={{ fontSize: 11, color: wsState === 'open' ? 'var(--color-safe)' : 'var(--color-warn)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: wsState === 'open' ? 'var(--color-safe)' : 'var(--color-warn)', animation: wsState === 'open' ? 'pulseSoft 2s infinite' : 'none' }} />
              {wsState === 'open' ? 'connected' : 'reconnecting'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button onClick={() => triggerSimulation(false)} className="btn" style={{ flex: 1, padding: '9px 0', fontSize: 12, background: 'var(--color-safe-soft)', color: '#277a55', border: '1px solid var(--color-safe)' }}>
              + Safe
            </button>
            <button onClick={() => triggerSimulation(true)} className="btn" style={{ flex: 1, padding: '9px 0', fontSize: 12, background: 'var(--color-alert-soft)', color: '#b23a54', border: '1px solid var(--color-alert)' }}>
              + Fraud
            </button>
            <button onClick={() => setIsCustomSimOpen(true)} className="btn btn-ghost" style={{ flex: 1, padding: '9px 0', fontSize: 12 }}>
              + Custom
            </button>
          </div>

          {/* Stream controls */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
            <button
              onClick={() => setStreaming((s) => !s)}
              className="btn"
              style={{
                flex: 1, padding: '9px 0', fontSize: 12,
                background: streaming ? 'var(--grad-violet-rose)' : 'var(--color-surface)',
                color: streaming ? '#fff' : 'var(--color-ink)',
                border: '1px solid var(--color-line-strong)',
              }}
            >
              {streaming ? '❚❚ Pause stream' : '▶ Start stream'}
            </button>
            <div style={{ display: 'flex', borderRadius: 999, border: '1px solid var(--color-line)', overflow: 'hidden' }}>
              {(['mock', 'replay'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStreamSource(s)}
                  title={s === 'mock' ? 'Generate new transactions' : 'Replay stored transactions from the database'}
                  style={{
                    padding: '8px 12px', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: streamSource === s ? 'var(--color-ink)' : 'transparent',
                    color: streamSource === s ? '#fff' : 'var(--color-ink-soft)',
                  }}
                >
                  {s === 'mock' ? 'Mock' : 'DB'}
                </button>
              ))}
            </div>
          </div>

          {/* Verdict filter */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {([
              ['ALL', 'All', 'var(--color-ink)'],
              ['SAFE', 'Safe', 'var(--color-safe)'],
              ['SUSPICIOUS', 'Susp.', 'var(--color-warn)'],
              ['FRAUD', 'Fraud', 'var(--color-alert)'],
            ] as const).map(([key, label, col]) => {
              const count = key === 'ALL' ? alerts.length : alerts.filter((a) => a.risk_label === key).length;
              const active = filter === key;
              return (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  style={{
                    flex: 1, padding: '7px 4px', borderRadius: 12, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${active ? col : 'var(--color-line)'}`,
                    background: active ? col : 'var(--color-surface)',
                    color: active ? '#fff' : 'var(--color-ink-soft)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  }}
                >
                  <span>{label}</span>
                  <span className="data" style={{ fontSize: 10, opacity: 0.8 }}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* Search + sort + pause + sound */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center' }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search entity / tx…"
              style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--color-line)', background: 'var(--color-surface)', color: 'var(--color-ink)', fontSize: 12, fontFamily: 'var(--font-mono)', outline: 'none' }}
            />
            <button onClick={() => setSortBy((s) => (s === 'time' ? 'risk' : 'time'))} title="Toggle sort: newest / highest risk"
              className="btn btn-ghost" style={{ padding: '8px 10px', fontSize: 11 }}>
              {sortBy === 'time' ? '↧ new' : '⚠ risk'}
            </button>
            <button onClick={togglePause} title={paused ? 'Resume feed' : 'Freeze feed'}
              className="btn" style={{ padding: '8px 10px', fontSize: 12, background: paused ? 'var(--color-warn)' : 'var(--color-surface)', color: paused ? '#fff' : 'var(--color-ink)', border: '1px solid var(--color-line-strong)' }}>
              {paused ? '▶' : '❚❚'}
            </button>
            <button onClick={() => setSoundOn((s) => !s)} title={soundOn ? 'Mute fraud alerts' : 'Sound on new fraud'}
              className="btn btn-ghost" style={{ padding: '8px 10px', fontSize: 13, opacity: soundOn ? 1 : 0.5 }}>
              {soundOn ? '🔔' : '🔕'}
            </button>
          </div>

          {loadingInitial ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={62} radius={14} />)}
            </div>
          ) : (
            <ThreatTicker
              alerts={displayedAlerts}
              onSelectAlert={setSelectedAlert}
              selectedAlertId={selectedAlert?.id}
            />
          )}

          {/* Pagination + export */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            {hasMore && !streaming && (
              <button onClick={loadMore} disabled={loadingMore} className="btn btn-ghost" style={{ flex: 1, padding: '9px 0', fontSize: 12 }}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
            <button onClick={exportCsv} title="Download full transaction history as CSV" className="btn btn-ghost" style={{ padding: '9px 12px', fontSize: 12, marginLeft: hasMore && !streaming ? 0 : 'auto' }}>
              ↓ CSV
            </button>
          </div>
        </section>

        {/* Center: feature correlation */}
        <section style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 16 }}>Feature correlation</h2>
            <span className="eyebrow" style={{ fontSize: 10 }}>amount × velocity</span>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <FeatureScatterPlot alerts={alerts} />
          </div>
          <div style={{ display: 'flex', gap: 18, marginTop: 12, justifyContent: 'center' }}>
            {[['Safe', 'var(--color-safe)'], ['Suspicious', 'var(--color-warn)'], ['Fraud', 'var(--color-alert)']].map(([l, c]) => (
              <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-ink-soft)' }}>
                <span style={{ width: 9, height: 9, borderRadius: 999, background: c }} /> {l}
              </span>
            ))}
          </div>
        </section>

        {/* Right: deep dive */}
        <section style={panelStyle}>
          <h2 style={{ fontSize: 16, marginBottom: 14 }}>Deep-dive inspection</h2>
          <DeepDivePanel alert={selectedAlert} onActionSuccess={handleActionSuccess} />
        </section>
      </main>

      <DynamicFooter />

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20, x: 20 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="glass"
            style={{ position: 'fixed', bottom: 90, right: 24, padding: '14px 20px', borderRadius: 16, zIndex: 60, borderLeft: `3px solid var(--color-${toast.type})` }}
          >
            <div className="eyebrow" style={{ fontSize: 10, marginBottom: 4 }}>Transaction logged</div>
            <div className="data" style={{ fontSize: 14, color: 'var(--color-ink)' }}>{toast.message}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom sim modal */}
      <AnimatePresence>
        {isCustomSimOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsCustomSimOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(36,26,51,0.35)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center', zIndex: 70, padding: 20 }}
          >
            <motion.div
              initial={{ scale: 0.96, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 12 }}
              onClick={(e) => e.stopPropagation()}
              className="lux-card"
              style={{ width: '100%', maxWidth: 540, padding: 30 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h3 style={{ fontSize: 22 }}>Custom transaction</h3>
                <button onClick={() => setIsCustomSimOpen(false)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--color-ink-faint)', lineHeight: 1 }}>×</button>
              </div>
              <form onSubmit={handleCustomSimSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <SimField label="Entity ID" value={simEntityId} onChange={setSimEntityId} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <SimField label="Amount ($)" type="number" value={simAmount} onChange={setSimAmount} />
                  <div>
                    <span className="eyebrow" style={{ display: 'block', marginBottom: 8, fontSize: 10 }}>Device shift</span>
                    <select value={simDeviceShift} onChange={(e) => setSimDeviceShift(e.target.value)} style={selectStyle}>
                      <option value="0">No shift</option>
                      <option value="1">Location shift (yes)</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                  <SimField label="Tx · 5m" type="number" value={simTx5m} onChange={setSimTx5m} />
                  <SimField label="Tx · 1h" type="number" value={simTx1h} onChange={setSimTx1h} />
                  <SimField label="Tx · 24h" type="number" value={simTx24h} onChange={setSimTx24h} />
                </div>
                <SimField label="Device fingerprint" value={simDeviceFp} onChange={setSimDeviceFp} />
                <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: 6 }}>
                  Inject transaction
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style jsx>{`
        @media (max-width: 1100px) {
          .ws-grid { grid-template-columns: 1fr !important; overflow-y: auto; }
        }
      `}</style>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  borderRadius: 12,
  border: '1px solid var(--color-line-strong)',
  background: 'var(--color-surface)',
  color: 'var(--color-ink)',
  fontSize: 14,
  fontFamily: 'var(--font-sans)',
};

function SimField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="eyebrow" style={{ display: 'block', marginBottom: 8, fontSize: 10 }}>{label}</span>
      <input
        type={type}
        step={type === 'number' ? '0.01' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="data"
        style={{ ...selectStyle }}
      />
    </label>
  );
}
