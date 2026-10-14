import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';

// Tweens a displayed number toward `value` (expo-out), starting from whatever
// is currently on screen so a live update mid-tween never jumps.
export function useAnimatedNumber(value, { duration = 0.9, decimals = 0 } = {}) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    const controls = animate(current.current, value, {
      duration: reduce ? 0 : duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        current.current = v;
        setDisplay(Number(v.toFixed(decimals)));
      },
    });
    return () => controls.stop();
  }, [value, duration, decimals, reduce]);

  return display;
}
