'use client';
import { useEffect } from 'react';

/**
 * CardTilt — adds a subtle 3D pointer-tilt to every `.lux-card` globally via a
 * single delegated listener. Purely additive: no component or style edits, CSS
 * transforms only (no WebGL), respects reduced-motion and coarse pointers.
 */
export default function CardTilt() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let current: HTMLElement | null = null;

    const reset = (el: HTMLElement) => {
      el.style.transition = 'transform 0.5s cubic-bezier(0.16,1,0.3,1), box-shadow 0.4s ease';
      el.style.transform = '';
      el.style.willChange = '';
    };

    const onMove = (e: PointerEvent) => {
      const card = (e.target as HTMLElement)?.closest?.('.lux-card') as HTMLElement | null;
      if (card !== current) {
        if (current) reset(current);
        current = card;
        if (card) {
          card.style.transition = 'transform 0.12s ease-out, box-shadow 0.3s ease';
          card.style.willChange = 'transform';
        }
      }
      if (!card) return;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5; // -0.5..0.5
      const py = (e.clientY - r.top) / r.height - 0.5;
      const rx = (-py * 5).toFixed(2);
      const ry = (px * 7).toFixed(2);
      card.style.transform = `perspective(1000px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-4px)`;
    };

    const onLeave = () => {
      if (current) { reset(current); current = null; }
    };

    document.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('blur', onLeave);
    return () => {
      document.removeEventListener('pointermove', onMove);
      window.removeEventListener('blur', onLeave);
      if (current) reset(current);
    };
  }, []);

  return null;
}
