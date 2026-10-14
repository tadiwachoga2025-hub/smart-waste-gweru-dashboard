// Shared Motion (motion/react) presets. Apple-style: critically damped by
// default; a touch of bounce only where a gesture carried momentum.
export const spring = { type: 'spring', bounce: 0, duration: 0.4 };
export const springSnappy = { type: 'spring', bounce: 0, duration: 0.28 };
export const springMomentum = { type: 'spring', bounce: 0.18, duration: 0.45 };

export const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { ...spring, duration: 0.5 } },
};

export const stagger = (step = 0.05, delay = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren: step, delayChildren: delay } },
});
