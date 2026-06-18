'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import Logo from '@/components/site/Logo';
import { useRole } from '@/components/RoleProvider';
import { apiFetch } from '@/lib/api';

interface Suggestion { label: string; href: string }
interface Msg { role: 'user' | 'assistant'; content: string; suggestions?: Suggestion[] }

const GREETING: Msg = {
  role: 'assistant',
  content: "Hi, I'm VaultAI — your fraud-ops copilot. Ask me for live stats, to explain a verdict, or to take you to any page.",
  suggestions: [
    { label: 'Fraud stats', href: '' },
    { label: 'System status', href: '/status' },
    { label: 'What can you do?', href: '' },
  ],
};

// Minimal typing for the Web Speech API (not in standard lib DOM types).
type SpeechRecognitionLike = {
  lang: string; interimResults: boolean; continuous: boolean;
  start: () => void; stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
};

export default function VaultAssistant() {
  const router = useRouter();
  const { role } = useRole();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const msgsRef = useRef<Msg[]>(msgs);
  const sendRef = useRef<((text?: string) => void) | null>(null);
  useEffect(() => { msgsRef.current = msgs; }, [msgs]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (Ctor) {
      setVoiceSupported(true);
      const r = new Ctor();
      r.lang = 'en-US'; r.interimResults = false; r.continuous = false;
      r.onresult = (e) => {
        const transcript = e.results[0][0].transcript;
        setInput(transcript);
        // auto-send the spoken query (sendRef stays current across renders)
        setTimeout(() => sendRef.current?.(transcript), 120);
      };
      r.onend = () => setListening(false);
      r.onerror = () => setListening(false);
      recogRef.current = r;
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, busy]);

  const speakOut = useCallback((text: string) => {
    if (!speak || typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05; u.pitch = 1;
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }, [speak]);

  const send = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput('');
    const next: Msg[] = [...msgsRef.current, { role: 'user', content }];
    setMsgs(next);
    setBusy(true);
    try {
      const res = await apiFetch('/v1/assistant/chat', {
        role: role || 'viewer',
        method: 'POST',
        body: JSON.stringify({ messages: next.slice(-10).map((m) => ({ role: m.role, content: m.content })) }),
      });
      if (res.ok) {
        const data = await res.json();
        setMsgs((prev) => [...prev, { role: 'assistant', content: data.reply, suggestions: data.suggestions }]);
        speakOut(data.reply);
      } else {
        setMsgs((prev) => [...prev, { role: 'assistant', content: "I couldn't reach the server just now. Is the backend running?" }]);
      }
    } catch {
      setMsgs((prev) => [...prev, { role: 'assistant', content: "I couldn't reach the server just now. Is the backend running?" }]);
    }
    setBusy(false);
  }, [input, busy, role, speakOut]);

  // keep sendRef current so the speech-recognition callback never goes stale
  useEffect(() => { sendRef.current = send; }, [send]);

  const toggleMic = () => {
    const r = recogRef.current;
    if (!r) return;
    if (listening) { r.stop(); setListening(false); return; }
    try { r.start(); setListening(true); } catch { setListening(false); }
  };

  const onSuggestion = (s: Suggestion) => {
    if (s.href) { router.push(s.href); setOpen(false); }
    else { send(s.label); }
  };

  return (
    <>
      {/* Launcher */}
      <motion.button
        onClick={() => setOpen((o) => !o)}
        aria-label="Open VaultAI assistant"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.4, type: 'spring', stiffness: 260, damping: 20 }}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 90,
          width: 60, height: 60, borderRadius: 999, cursor: 'pointer',
          border: '1px solid var(--color-line-strong)',
          background: 'var(--color-surface)',
          boxShadow: 'var(--shadow-lg)',
          display: open ? 'none' : 'grid', placeItems: 'center',
        }}
      >
        <span style={{ position: 'absolute', inset: 0, borderRadius: 999, background: 'var(--grad-violet-rose)', opacity: 0.16 }} />
        <span style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
          <Logo size={32} />
        </span>
        <span style={{ position: 'absolute', bottom: 6, right: 8, width: 9, height: 9, borderRadius: 999, background: 'var(--color-safe)', border: '2px solid var(--color-surface)' }} />
      </motion.button>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 280, damping: 26 }}
            className="lux-card"
            style={{
              position: 'fixed', bottom: 24, right: 24, zIndex: 95,
              width: 'min(400px, calc(100vw - 32px))', height: 'min(580px, calc(100vh - 48px))',
              padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderBottom: '1px solid var(--color-line)', background: 'var(--color-surface-2)' }}>
              <Logo size={30} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, lineHeight: 1.1 }}>VaultAI</div>
                <div className="data" style={{ fontSize: 10.5, color: 'var(--color-ink-faint)' }}>fraud-ops copilot</div>
              </div>
              <button onClick={() => setSpeak((s) => !s)} title={speak ? 'Mute voice replies' : 'Speak replies aloud'}
                aria-label="Toggle voice replies"
                style={{ ...iconBtn, color: speak ? 'var(--color-violet)' : 'var(--color-ink-faint)' }}>
                {speak ? '🔊' : '🔇'}
              </button>
              <button onClick={() => setOpen(false)} aria-label="Close" style={iconBtn}>✕</button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {msgs.map((m, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 8 }}>
                  <div style={{
                    maxWidth: '88%', padding: '10px 14px', borderRadius: 16, fontSize: 13.5, lineHeight: 1.5,
                    background: m.role === 'user' ? 'var(--grad-violet-rose)' : 'var(--color-surface-2)',
                    color: m.role === 'user' ? '#fff' : 'var(--color-ink)',
                    border: m.role === 'user' ? 'none' : '1px solid var(--color-line)',
                    borderBottomRightRadius: m.role === 'user' ? 4 : 16,
                    borderBottomLeftRadius: m.role === 'user' ? 16 : 4,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {m.content}
                  </div>
                  {m.suggestions && m.suggestions.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {m.suggestions.map((s, j) => (
                        <button key={j} onClick={() => onSuggestion(s)} style={{
                          padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                          border: '1px solid var(--color-line-strong)', background: 'var(--color-surface)', color: 'var(--color-ink-soft)',
                        }}>
                          {s.href ? '↗ ' : ''}{s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {busy && (
                <div style={{ display: 'flex', gap: 4, padding: '10px 14px', alignSelf: 'flex-start' }}>
                  {[0, 1, 2].map((i) => (
                    <motion.span key={i} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }}
                      style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--color-violet)' }} />
                  ))}
                </div>
              )}
            </div>

            {/* Input */}
            <div style={{ padding: 12, borderTop: '1px solid var(--color-line)', display: 'flex', gap: 8, alignItems: 'center' }}>
              {voiceSupported && (
                <button onClick={toggleMic} title={listening ? 'Stop listening' : 'Speak'} aria-label="Voice input"
                  style={{ ...iconBtn, width: 40, height: 40, flexShrink: 0,
                    background: listening ? 'var(--color-alert)' : 'var(--color-surface-2)',
                    color: listening ? '#fff' : 'var(--color-ink)',
                    border: `1px solid ${listening ? 'var(--color-alert)' : 'var(--color-line-strong)'}` }}>
                  {listening ? (
                    <motion.span animate={{ scale: [1, 1.25, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>🎙</motion.span>
                  ) : '🎙'}
                </button>
              )}
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
                placeholder={listening ? 'Listening…' : 'Ask VaultAI…'}
                style={{ flex: 1, minWidth: 0, padding: '11px 14px', borderRadius: 999, border: '1px solid var(--color-line-strong)', background: 'var(--color-surface)', color: 'var(--color-ink)', fontSize: 13.5, outline: 'none' }}
              />
              <button onClick={() => send()} disabled={!input.trim() || busy} aria-label="Send"
                className="btn btn-primary" style={{ width: 40, height: 40, padding: 0, borderRadius: 999, flexShrink: 0 }}>
                ↑
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

const iconBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 999, border: 'none', background: 'transparent',
  color: 'var(--color-ink-soft)', cursor: 'pointer', fontSize: 15,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
};
