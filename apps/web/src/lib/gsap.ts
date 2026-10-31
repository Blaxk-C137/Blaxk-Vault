/**
 * GSAP setup — signature interactions only (blueprint §4).
 *
 * Rules encoded here:
 *   - `gsap.matchMedia()` drives every animation so `prefers-reduced-motion`
 *     automatically yields a static, fully usable interface.
 *   - Timelines are created inside a `useGSAP` scope so they are reverted on
 *     unmount; nothing leaks between routes (blueprint §4: "clean up animations
 *     on unmount").
 *   - Never more than a handful of elements animate at once: hero entrance,
 *     page transition, sidebar indicator, and one staggered poster reveal.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(ScrollTrigger, useGSAP);

/** Shared timing vocabulary so the whole app moves like one product. */
export const MOTION = {
  dur: { fast: 0.24, base: 0.42, slow: 0.72 },
  ease: { out: 'power3.out', inOut: 'power2.inOut', soft: 'expo.out' },
} as const;

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  const override = document.documentElement.dataset.motion;
  if (override === 'reduce') return true;
  if (override === 'allow') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export { gsap, ScrollTrigger, useGSAP };
