'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';

// Interactive 3D — client-only, code-split so they never block first paint.
const VaultCore = dynamic(() => import('@/components/three/VaultCore'), {
  ssr: false,
  loading: () => null,
});
const TransactionNetwork = dynamic(() => import('@/components/three/TransactionNetwork'), {
  ssr: false,
  loading: () => null,
});
const CtaGem = dynamic(() => import('@/components/three/CtaGem'), {
  ssr: false,
  loading: () => null,
});
import SiteNav from '@/components/site/SiteNav';
import SiteFooter from '@/components/site/SiteFooter';
import DynamicBackground from '@/components/site/DynamicBackground';
import Preloader from '@/components/site/Preloader';
import { SectionHeading, StatTile, Card, Badge, Marquee } from '@/components/ui';
import CircleExpandButton from '@/components/fx/CircleExpandButton';
import TextIndenter from '@/components/fx/TextIndenter';
import ArcText from '@/components/fx/ArcText';
import ImageScroller from '@/components/fx/ImageScroller';
import ProductSlideshow, { Slide } from '@/components/fx/ProductSlideshow';
import LiveFilterStream from '@/components/fx/LiveFilterStream';
import MiniArt from '@/components/fx/MiniArt';

type Tone = 'safe' | 'warn' | 'alert';
interface Tick {
  id: string;
  label: 'SAFE' | 'SUSPICIOUS' | 'FRAUD';
  tone: Tone;
  user: string;
  amount: number;
  latency: number;
}

function makeTick(): Tick {
  const isFraud = Math.random() < 0.22;
  const isSus = !isFraud && Math.random() < 0.32;
  const label = isFraud ? 'FRAUD' : isSus ? 'SUSPICIOUS' : 'SAFE';
  const tone: Tone = isFraud ? 'alert' : isSus ? 'warn' : 'safe';
  return {
    id: Math.random().toString(36).slice(2),
    label,
    tone,
    user: `user_${Math.floor(Math.random() * 9000 + 1000)}`,
    amount: isFraud
      ? Math.random() * 8000 + 2000
      : isSus
      ? Math.random() * 900 + 100
      : Math.random() * 90 + 5,
    latency: Math.floor(Math.random() * 26 + 6),
  };
}

function LiveTicker() {
  const [ticks, setTicks] = useState<Tick[]>([]);
  // Client-only random content — seeded in an effect to avoid SSR hydration mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTicks(Array.from({ length: 4 }, makeTick));
    const t = setInterval(() => {
      setTicks((prev) => [makeTick(), ...prev].slice(0, 5));
    }, 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {ticks.map((t, i) => (
        <motion.div
          key={t.id}
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: i === 0 ? 1 : 0.96 - i * 0.12, y: 0, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 16px',
            borderRadius: 16,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-line)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Badge tone={t.tone}>{t.label}</Badge>
            <span className="data" style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
              {t.user}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="data" style={{ fontSize: 13, fontWeight: 600 }}>
              ${t.amount.toFixed(2)}
            </span>
            <span className="data" style={{ fontSize: 12, color: 'var(--color-mint)' }}>
              {t.latency}ms
            </span>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

const PIPELINE = [
  { step: '01', title: 'Ingest', body: 'REST + Kafka producers capture every transaction event with sub-millisecond enqueue.', color: 'var(--color-violet)', art: 'ingest' as const },
  { step: '02', title: 'Stream', body: 'Redpanda topics fan out events to feature consumers and the scoring service.', color: 'var(--color-sky)', art: 'stream' as const },
  { step: '03', title: 'Feature Store', body: 'Redis sliding windows compute velocity, z-scores and device-shift in real time.', color: 'var(--color-mint)', art: 'features' as const },
  { step: '04', title: 'Score', body: 'XGBoost evaluates 430+ engineered features and returns a calibrated risk score.', color: 'var(--color-gold)', art: 'score' as const },
  { step: '05', title: 'Decide', body: 'Alerts broadcast over WebSocket to analysts who freeze or escalate instantly.', color: 'var(--color-rose)', art: 'decide' as const },
];

const CAPABILITY_SLIDES: Slide[] = [
  {
    id: 'scoring',
    label: 'Real-time scoring',
    content: (
      <Card hover={false} style={{ padding: 36 }}>
        <Badge tone="safe">Sub-30ms p95</Badge>
        <h3 style={{ fontSize: 28, margin: '18px 0 12px' }}>Score every transaction as it happens</h3>
        <p style={{ color: 'var(--color-ink-soft)', lineHeight: 1.6, maxWidth: 560 }}>
          A streaming XGBoost classifier trained on the IEEE-CIS benchmark evaluates hundreds
          of engineered features per event — velocity, spend volume, device shifts and
          categorical encodings — and returns a calibrated probability with a tuned decision
          threshold.
        </p>
        <div style={{ display: 'flex', gap: 32, marginTop: 28, flexWrap: 'wrap' }}>
          <StatTile value="0.92" label="Validation AUC" />
          <StatTile value="1.1%" label="False positive rate" accent="var(--color-mint)" />
          <StatTile value="430+" label="Features / event" accent="var(--color-gold)" />
        </div>
      </Card>
    ),
  },
  {
    id: 'explain',
    label: 'Explainability',
    content: (
      <Card hover={false} style={{ padding: 36 }}>
        <Badge tone="warn">Glass-box</Badge>
        <h3 style={{ fontSize: 28, margin: '18px 0 12px' }}>Every decision is explainable</h3>
        <p style={{ color: 'var(--color-ink-soft)', lineHeight: 1.6, maxWidth: 560 }}>
          Per-alert SHAP-style contributions show exactly which factors drove a score toward
          fraud or suppressed it toward safe — so analysts and auditors can trust and defend
          every automated decision.
        </p>
        <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { f: 'Device location shift', v: 0.35, pos: true },
            { f: 'Spend volume (1h)', v: 0.18, pos: true },
            { f: 'Tx frequency (24h)', v: -0.12, pos: false },
          ].map((r) => (
            <div key={r.f} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 180, fontSize: 13, color: 'var(--color-ink-soft)' }}>{r.f}</span>
              <div style={{ flex: 1, height: 10, borderRadius: 999, background: 'var(--color-canvas-2)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.abs(r.v) * 180}%`, height: '100%', borderRadius: 999, background: r.pos ? 'var(--color-alert)' : 'var(--color-safe)' }} />
              </div>
              <span className="data" style={{ width: 52, fontSize: 12, color: r.pos ? 'var(--color-alert)' : 'var(--color-safe)' }}>
                {r.pos ? '+' : ''}{r.v.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </Card>
    ),
  },
  {
    id: 'lab',
    label: 'Model Lab',
    content: (
      <Card hover={false} style={{ padding: 36 }}>
        <Badge tone="neutral">MLOps</Badge>
        <h3 style={{ fontSize: 28, margin: '18px 0 12px' }}>Train, compare & promote models</h3>
        <p style={{ color: 'var(--color-ink-soft)', lineHeight: 1.6, maxWidth: 560 }}>
          The built-in Model Lab lets you train XGBoost, Random Forest, Logistic Regression or
          Isolation Forest on demand, watch metrics stream live, and promote the best run
          straight into production with one click — a complete model registry.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 26, flexWrap: 'wrap' }}>
          {['XGBoost', 'Random Forest', 'Logistic Regression', 'Isolation Forest'].map((m) => (
            <span key={m} className="badge badge-neutral">{m}</span>
          ))}
        </div>
      </Card>
    ),
  },
];

const FAQS = [
  { q: 'What data does the model use?', a: 'VaultStream is trained on the IEEE-CIS Fraud Detection benchmark (≈590K transactions) and augments it at inference time with real-time velocity and behavioural features computed in Redis.' },
  { q: 'How fast is scoring?', a: 'End-to-end p95 latency is under 30ms — ingestion through Kafka, feature lookup in Redis, XGBoost inference, and WebSocket alert broadcast.' },
  { q: 'Is it explainable?', a: 'Yes. Every alert carries per-feature contribution weights so analysts and compliance teams can see precisely why a transaction was flagged.' },
  { q: 'Can I retrain or swap models?', a: 'The Model Lab supports on-demand training across four algorithm families with live metrics, a run registry, and one-click promotion to production.' },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      onClick={() => setOpen((o) => !o)}
      style={{
        borderBottom: '1px solid var(--color-line)',
        padding: '24px 4px',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--color-ink)' }}>{q}</span>
        <motion.span animate={{ rotate: open ? 45 : 0 }} style={{ fontSize: 26, color: 'var(--color-violet)', lineHeight: 1 }}>
          +
        </motion.span>
      </div>
      <motion.div
        initial={false}
        animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0, marginTop: open ? 14 : 0 }}
        style={{ overflow: 'hidden' }}
      >
        <p style={{ color: 'var(--color-ink-soft)', lineHeight: 1.65, maxWidth: 720 }}>{a}</p>
      </motion.div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <>
      <Preloader />
      <DynamicBackground />
      <SiteNav />

      {/* ===== Hero ===== */}
      <section style={{ position: 'relative', overflow: 'hidden', paddingTop: 150, paddingBottom: 80 }}>
        <div className="aurora-blob" style={{ width: 520, height: 520, background: 'var(--color-violet-soft)', top: -120, left: -100 }} />
        <div className="aurora-blob" style={{ width: 460, height: 460, background: 'var(--color-rose-soft)', top: 40, right: -120 }} />
        <div className="aurora-blob" style={{ width: 360, height: 360, background: 'var(--color-mint-soft)', bottom: -120, left: '40%' }} />

        <div
          className="section hero-grid"
          style={{ position: 'relative', zIndex: 1, paddingTop: 0, paddingBottom: 0, display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 56, alignItems: 'center' }}
        >
          <div>
            <TextIndenter
              as="h1"
              immediate
              style={{ fontSize: 'clamp(40px, 5.4vw, 70px)', fontWeight: 500, lineHeight: 1.02 }}
              lines={[
                <>Fraud intelligence,</>,
                <>rendered in</>,
                <span key="rt" className="text-gradient" style={{ fontStyle: 'italic', paddingRight: '0.12em' }}>
                  real time
                </span>,
              ]}
            />

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.35 }}
              style={{ fontSize: 19, lineHeight: 1.6, color: 'var(--color-ink-soft)', maxWidth: 520, margin: '28px 0 36px' }}
            >
              A streaming decision platform that scores every transaction in under 30
              milliseconds — explainable machine learning, a live analyst command center,
              and a built-in model lab.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}
            >
              <CircleExpandButton href="/signup">Launch workspace</CircleExpandButton>
              <CircleExpandButton href="#pipeline" tone="ink">
                See how it works
              </CircleExpandButton>
            </motion.div>
          </div>

          {/* Hero visual: interactive 3D core + arc seal backdrop + live ticker card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            style={{ position: 'relative', minHeight: 460 }}
          >
            {/* Faint rotating seal behind the 3D core */}
            <div style={{ position: 'absolute', top: 10, left: 0, right: 0, display: 'grid', placeItems: 'center', opacity: 0.22, zIndex: 0 }}>
              <ArcText size={360} />
            </div>
            {/* Interactive 3D core (drag to rotate) */}
            <div style={{ position: 'relative', zIndex: 1, height: 320, cursor: 'grab' }}>
              <VaultCore />
            </div>
            {/* Live ticker overlapping in front */}
            <div className="glass" style={{ borderRadius: 28, padding: 20, position: 'relative', zIndex: 2, marginTop: -36 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, padding: '0 4px' }}>
                <span className="eyebrow">Live threat stream</span>
                <span className="data" style={{ fontSize: 11, color: 'var(--color-safe)' }}>● streaming</span>
              </div>
              <LiveTicker />
            </div>
          </motion.div>
        </div>
      </section>

      {/* ===== Trust marquee ===== */}
      <div style={{ padding: '20px 0 40px' }}>
        <div className="section" style={{ padding: '0 32px' }}>
          <p className="eyebrow" style={{ textAlign: 'center', marginBottom: 26 }}>
            Built on the stack trusted by modern risk teams
          </p>
          <Marquee
            items={['REDPANDA', 'KAFKA', 'REDIS', 'XGBOOST', 'FASTAPI', 'SUPABASE', 'NEXT.JS', 'IEEE-CIS'].map((s) => (
              <span key={s} style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--color-ink-faint)' }}>{s}</span>
            ))}
          />
        </div>
      </div>

      {/* ===== Metrics band ===== */}
      <section id="metrics" className="section" style={{ paddingTop: 40 }}>
        <div className="lux-card metrics-grid" style={{ padding: '52px 48px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 32 }}>
          <StatTile value="0.92" label="Validation AUC" sub="IEEE-CIS benchmark" />
          <StatTile value="<30ms" label="p95 scoring latency" accent="var(--color-mint)" sub="ingest → decision" />
          <StatTile value="472K" label="Training samples" accent="var(--color-gold)" sub="chronological split" />
          <StatTile value="1.1%" label="False positive rate" accent="var(--color-rose)" sub="at tuned threshold" />
        </div>
      </section>

      {/* ===== Immersive 3D network ===== */}
      <section id="network" style={{ position: 'relative', overflow: 'hidden', minHeight: 640, display: 'flex', alignItems: 'center', marginTop: 20 }}>
        <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
          <TransactionNetwork />
        </div>
        <div className="section" style={{ position: 'relative', zIndex: 1, pointerEvents: 'none', textAlign: 'center', paddingTop: 0, paddingBottom: 0 }}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            style={{ maxWidth: 640, margin: '0 auto' }}
          >
            <div className="eyebrow" style={{ marginBottom: 18 }}>The network, watched</div>
            <h2 style={{ fontSize: 'clamp(30px, 4.5vw, 56px)', marginBottom: 18 }}>
              Every node, every edge, <span className="text-gradient" style={{ fontStyle: 'italic' }}>under watch</span>
            </h2>
            <p style={{ fontSize: 18, lineHeight: 1.6, color: 'var(--color-ink-soft)', maxWidth: 520, margin: '0 auto' }}>
              VaultStream sees transactions as a living graph — entities, devices and merchants
              connected in real time. Fraud lights up the moment it moves.
            </p>
            <div style={{ display: 'flex', gap: 22, justifyContent: 'center', marginTop: 26 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-ink-soft)' }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--color-safe)' }} /> Safe
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-ink-soft)' }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--color-alert)' }} /> Fraud signal
              </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-ink-faint)', marginTop: 22 }}>move your cursor to orbit the graph</p>
          </motion.div>
        </div>
      </section>

      {/* ===== Live filtering showcase ===== */}
      <section id="filter" className="section" style={{ paddingTop: 40 }}>
        <SectionHeading
          eyebrow="See it work"
          title={<>Watch the model <span className="text-gradient" style={{ fontStyle: 'italic' }}>filter fraud</span> live</>}
          subtitle="A continuous transaction stream, sorted into safe, suspicious and fraud in real time. Switch models to see how each one decides."
        />
        <div style={{ marginTop: 48 }}>
          <LiveFilterStream />
        </div>
      </section>

      {/* ===== Pipeline ===== */}
      <section id="pipeline" className="section">
        <SectionHeading
          eyebrow="How it works"
          title={<>Five stages, <span className="text-gradient" style={{ fontStyle: 'italic' }}>milliseconds</span> apart</>}
          subtitle="Every transaction flows through a streaming pipeline engineered for speed and explainability."
        />
        <div className="pipeline-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 18, marginTop: 56 }}>
          {PIPELINE.map((p, i) => (
            <motion.div
              key={p.step}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            >
              <Card style={{ height: '100%', padding: 24 }}>
                <div className="data" style={{ fontSize: 13, color: p.color, fontWeight: 600, marginBottom: 14 }}>{p.step}</div>
                <div style={{ width: 64, height: 40, marginBottom: 16, color: p.color }}>
                  <MiniArt kind={p.art} color={p.color} accent="var(--color-rose)" />
                </div>
                <h3 style={{ fontSize: 21, marginBottom: 10 }}>{p.title}</h3>
                <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--color-ink-soft)' }}>{p.body}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ===== Capabilities slideshow ===== */}
      <section id="platform" className="section">
        <SectionHeading
          eyebrow="The platform"
          title={<>Everything a risk team needs, <span className="text-gradient" style={{ fontStyle: 'italic' }}>in one place</span></>}
        />
        <div style={{ marginTop: 48 }}>
          <ProductSlideshow slides={CAPABILITY_SLIDES} />
        </div>
      </section>

      {/* ===== Feature scroller ===== */}
      <section className="section" style={{ paddingTop: 20 }}>
        <ImageScroller
          items={([
            { t: 'Velocity engine', d: 'Sliding-window counts across 5m / 1h / 24h horizons.', art: 'velocity', color: 'var(--color-violet)' },
            { t: 'Device intelligence', d: 'Fingerprint shift detection flags account takeover.', art: 'device', color: 'var(--color-rose)' },
            { t: 'Amount anomaly', d: 'Welford z-scores surface out-of-pattern spend.', art: 'amount', color: 'var(--color-mint)' },
            { t: 'Case actions', d: 'Freeze or escalate with a full audit trail.', art: 'case', color: 'var(--color-gold)' },
            { t: 'Threshold tuner', d: 'Trade precision against recall in real time.', art: 'threshold', color: 'var(--color-sky)' },
          ] as const).map((card) => (
            <div key={card.t} style={{ width: 300 }}>
              <Card style={{ padding: 26, height: 210 }}>
                <div style={{ width: '100%', height: 76, marginBottom: 16, borderRadius: 14, background: 'var(--color-surface-2)', border: '1px solid var(--color-line)', padding: 12 }}>
                  <MiniArt kind={card.art} color={card.color} accent="var(--color-rose)" />
                </div>
                <h3 style={{ fontSize: 19, marginBottom: 8 }}>{card.t}</h3>
                <p style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--color-ink-soft)' }}>{card.d}</p>
              </Card>
            </div>
          ))}
        />
      </section>

      {/* ===== FAQ ===== */}
      <section id="faq" className="section">
        <SectionHeading eyebrow="FAQ" title="Questions, answered" />
        <div style={{ marginTop: 40, maxWidth: 860, marginInline: 'auto' }}>
          {FAQS.map((f) => (
            <FAQItem key={f.q} q={f.q} a={f.a} />
          ))}
        </div>
      </section>

      {/* ===== CTA band ===== */}
      <section className="section">
        <div
          style={{
            position: 'relative',
            overflow: 'hidden',
            borderRadius: 40,
            padding: '72px 48px',
            textAlign: 'center',
            background: 'var(--grad-aurora)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {/* Interactive 3D gems floating in the band */}
          <div style={{ position: 'absolute', top: -30, right: -10, width: 220, height: 220, opacity: 0.9 }}>
            <CtaGem />
          </div>
          <div style={{ position: 'absolute', bottom: -50, left: -30, width: 180, height: 180, opacity: 0.7 }}>
            <CtaGem />
          </div>
          <h2 style={{ position: 'relative', zIndex: 1, fontSize: 'clamp(30px, 4.5vw, 52px)', color: '#fff', marginBottom: 18 }}>
            Stop fraud before it settles
          </h2>
          <p style={{ position: 'relative', zIndex: 1, color: 'rgba(255,255,255,0.92)', fontSize: 18, maxWidth: 560, margin: '0 auto 34px', lineHeight: 1.6 }}>
            Spin up the live workspace and watch transactions get scored, explained and actioned
            in real time.
          </p>
          <div style={{ position: 'relative', zIndex: 1, display: 'inline-flex', gap: 14 }}>
            <CircleExpandButton href="/signup" tone="gold">Get started free</CircleExpandButton>
          </div>
        </div>
      </section>

      <SiteFooter />

      <style jsx global>{`
        @media (max-width: 980px) {
          .pipeline-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .metrics-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 760px) {
          .hero-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  );
}
