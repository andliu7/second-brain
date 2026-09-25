// True when the OS asks for less motion. Read at the moment it matters, not once at import, so
// a test (or a settings change) is seen by the next render.
export const prefersReducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && Boolean(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
