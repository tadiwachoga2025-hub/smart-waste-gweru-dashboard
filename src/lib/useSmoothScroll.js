import { useEffect } from 'react';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * Lenis smooth scrolling driven by GSAP's ticker so ScrollTrigger and Lenis
 * share one clock. Disabled under prefers-reduced-motion (native scroll).
 * Map containers opt out with `data-lenis-prevent`.
 */
export function useSmoothScroll() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return undefined;

    const lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 0.9, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    const raf = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    window.__lenis = lenis;

    return () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
      delete window.__lenis;
    };
  }, []);
}

/**
 * Scroll-linked reveal for elements matching `selector` inside `scope`.
 * Elements are visible by default (no FOUC if JS/GSAP fails); the tween only
 * lifts them in from a small offset as they enter the viewport.
 */
export function useScrollReveal(scopeRef, selector, deps = []) {
  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const ctx = gsap.context(() => {
      ScrollTrigger.batch(scope.querySelectorAll(selector), {
        start: 'top 92%',
        once: true,
        onEnter: (els) =>
          gsap.fromTo(
            els,
            { autoAlpha: 0, y: 14 },
            { autoAlpha: 1, y: 0, duration: 0.6, ease: 'expo.out', stagger: 0.05, overwrite: true },
          ),
      });
    }, scope);
    ScrollTrigger.refresh();
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export { gsap, ScrollTrigger };
