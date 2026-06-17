'use client';
import { ReactNode, useRef } from 'react';
import { motion, useAnimationFrame } from 'framer-motion';

/**
 * Image Scroller — an infinite horizontally auto-scrolling rail that can also
 * be dragged. Native re-creation of the Framer "ImageScroller" component.
 * Accepts arbitrary cards/images as items.
 */
export default function ImageScroller({
  items,
  speed = 0.6,
  gap = 28,
  className = '',
}: {
  items: ReactNode[];
  speed?: number;
  gap?: number;
  className?: string;
}) {
  const x = useRef(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const halfWidth = useRef(0);
  const paused = useRef(false);

  const loop = [...items, ...items];

  useAnimationFrame(() => {
    if (paused.current || !trackRef.current) return;
    if (halfWidth.current === 0) {
      halfWidth.current = trackRef.current.scrollWidth / 2;
    }
    x.current -= speed;
    if (Math.abs(x.current) >= halfWidth.current) {
      x.current = 0;
    }
    trackRef.current.style.transform = `translateX(${x.current}px)`;
  });

  return (
    <div
      className={className}
      style={{
        // Clip horizontally only so card shadows / rounded tops aren't cropped vertically.
        overflowX: 'hidden',
        overflowY: 'visible',
        width: '100%',
        padding: '26px 0',
        maskImage:
          'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
        WebkitMaskImage:
          'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
      }}
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
    >
      <motion.div
        ref={trackRef}
        style={{ display: 'flex', gap, width: 'max-content', willChange: 'transform' }}
        drag="x"
        dragConstraints={{ left: -2000, right: 2000 }}
        dragElastic={0.08}
        onDragStart={() => (paused.current = true)}
        onDragEnd={() => (paused.current = false)}
      >
        {loop.map((item, i) => (
          <div key={i} style={{ flex: '0 0 auto' }}>
            {item}
          </div>
        ))}
      </motion.div>
    </div>
  );
}
