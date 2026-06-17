'use client';
import { ReactNode, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface Slide {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * Product Slideshow — crossfading slideshow with tab/thumbnail navigation and
 * autoplay. Native re-creation of the Framer "ProductSlideshow" component.
 */
export default function ProductSlideshow({
  slides,
  autoplay = 5000,
  className = '',
}: {
  slides: Slide[];
  autoplay?: number;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const go = useCallback(
    (i: number) => setIndex((i + slides.length) % slides.length),
    [slides.length]
  );

  useEffect(() => {
    if (!autoplay || paused) return;
    const t = setTimeout(() => go(index + 1), autoplay);
    return () => clearTimeout(t);
  }, [index, autoplay, paused, go]);

  return (
    <div
      className={className}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          justifyContent: 'center',
          marginBottom: 28,
        }}
      >
        {slides.map((s, i) => (
          <button
            key={s.id}
            onClick={() => go(i)}
            style={{
              padding: '9px 18px',
              borderRadius: 999,
              border: '1px solid',
              borderColor: i === index ? 'transparent' : 'var(--color-line)',
              background: i === index ? 'var(--grad-violet-rose)' : 'var(--color-surface)',
              color: i === index ? '#fff' : 'var(--color-ink-soft)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              boxShadow: i === index ? 'var(--shadow-glow)' : 'none',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Stage */}
      <div style={{ position: 'relative', minHeight: 320 }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={slides[index].id}
            initial={{ opacity: 0, y: 18, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.99 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            {slides[index].content}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Progress dots */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 28 }}>
        {slides.map((s, i) => (
          <button
            key={s.id}
            aria-label={`Go to ${s.label}`}
            onClick={() => go(i)}
            style={{
              width: i === index ? 30 : 9,
              height: 9,
              borderRadius: 999,
              border: 'none',
              cursor: 'pointer',
              background: i === index ? 'var(--color-violet)' : 'var(--color-violet-soft)',
              transition: 'all 0.4s cubic-bezier(0.16,1,0.3,1)',
            }}
          />
        ))}
      </div>
    </div>
  );
}
