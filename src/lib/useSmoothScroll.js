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
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    let lenis = null;
    let raf = null;

    const start = () => {
      if (lenis) return;
      lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 0.9, smoothWheel: true });
      lenis.on('scroll', ScrollTrigger.update);
      raf = (time) => lenis.raf(time * 1000);
      gsap.ticker.add(raf);
      gsap.ticker.lagSmoothing(0);
      window.__lenis = lenis;
    };

    const stop = () => {
      if (!lenis) return;
      gsap.ticker.remove(raf);
      lenis.destroy();
      lenis = null;
      raf = null;
      delete window.__lenis;
    };

    // React live to the setting: smooth when allowed, native when reduced.
    const onChange = (e) => (e.matches ? stop() : start());
    if (!query.matches) start();
    query.addEventListener('change', onChange);

    return () => {
      query.removeEventListener('change', onChange);
      stop();
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
