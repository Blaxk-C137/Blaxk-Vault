import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '@/lib/gsap';

/** Reactive reduced-motion flag that also honours the in-app override. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => prefersReducedMotion());

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(prefersReducedMotion());
    media.addEventListener('change', update);
    document.addEventListener('blaxkvault:motion-change', update);
    return () => {
      media.removeEventListener('change', update);
      document.removeEventListener('blaxkvault:motion-change', update);
    };
  }, []);

  return reduced;
}
