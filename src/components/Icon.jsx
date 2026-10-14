// One stroke icon system (24px grid, 1.6 stroke, round caps).
// Usage: <Icon name="truck" size={20} />

const PATHS = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15Z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  chevronDown: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  arrowUpRight: <path d="M7 17 17 7M8.5 7H17v8.5" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M4 4l5 5M20 4l-5 5M4 20l5-5M20 20l-5-5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
      <path d="M8 3.5v4M16 3.5v4M4 10h16" />
    </>
  ),
  filter: <path d="M4 7h16M7 12h10M10 17h4" />,
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.8h5V7" />
      <path d="M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7" />
      <path d="M10.3 11v5.5M13.7 11v5.5" />
    </>
  ),
  recycle: (
    <>
      <path d="m7.2 19.5-2.6-.1a1.8 1.8 0 0 1-1.5-2.7l2.3-4" />
      <path d="M9.6 19.5h9.1a1.8 1.8 0 0 0 1.5-2.7l-1.4-2.4" />
      <path d="m7.5 8.3 2.9-5a1.8 1.8 0 0 1 3.1 0l1.4 2.4" />
      <path d="m12.3 17 -2.7 2.5 2.7 2.5M5.5 9.6l2-1.3-.6-2.4M18.9 10.3l-.4 3.7-3.4-1" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 19c0-8 5-13.5 14.5-14-.3 9.5-5.5 14.5-13.6 14.5" />
      <path d="M5 19c3-4 6-6.5 9.5-8.5" />
    </>
  ),
  hazard: (
    <>
      <path d="M10.4 4.4a1.8 1.8 0 0 1 3.2 0l7.3 13a1.8 1.8 0 0 1-1.6 2.7H4.7a1.8 1.8 0 0 1-1.6-2.7Z" />
      <path d="M12 9.5v4.2M12 16.6v.2" />
    </>
  ),
  truck: (
    <>
      <path d="M2.5 7.5h12v8.8h-12z" />
      <path d="M14.5 10h3.7l3.3 3.3v3h-7" />
      <circle cx="6" cy="17.3" r="1.7" />
      <circle cx="10" cy="17.3" r="1.7" />
      <circle cx="18" cy="17.3" r="1.7" />
    </>
  ),
  van: (
    <>
      <path d="M3 7.5h10.5l4 4.3H21v4.7H3z" />
      <path d="M13.5 7.5v4.3h4" />
      <circle cx="7.5" cy="17" r="1.8" />
      <circle cx="17" cy="17" r="1.8" />
    </>
  ),
  car: (
    <>
      <path d="M3.5 15.5v-2.8l2-4.2h9.5l3.5 4H21v3H3.5Z" />
      <path d="M6 12.5h12" />
      <circle cx="7.5" cy="16.5" r="1.7" />
      <circle cx="16.8" cy="16.5" r="1.7" />
    </>
  ),
  trailer: (
    <>
      <path d="M1.8 7h11.5v9.5H1.8zM13.3 9.5h4.2l3 3v4h-7.2" />
      <circle cx="4.8" cy="17.5" r="1.5" />
      <circle cx="8.6" cy="17.5" r="1.5" />
      <circle cx="17.5" cy="17.5" r="1.5" />
      <path d="M17.5 9.5v3h3" />
    </>
  ),
  cycle: (
    <>
      <circle cx="6" cy="17" r="3" />
      <circle cx="18" cy="17" r="3" />
      <path d="M6 17h4.5l3-6.5H9M13.5 10.5 18 17M15.5 7h2.5l1 3.5" />
      <path d="M9 5h4v5.5" />
    </>
  ),
  bin: (
    <>
      <path d="M5 8.5h14l-1.3 11a1.5 1.5 0 0 1-1.5 1.3H7.8a1.5 1.5 0 0 1-1.5-1.3Z" />
      <path d="M4 8.5h16M9.5 8.5 10 5h4l.5 3.5" />
    </>
  ),
  pin: (
    <>
      <path d="M19 10.2c0 5-7 10.8-7 10.8s-7-5.8-7-10.8a7 7 0 0 1 14 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="18" r="2.3" />
      <circle cx="18" cy="6" r="2.3" />
      <path d="M8.3 18H16a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h7.7" />
    </>
  ),
  weight: (
    <>
      <path d="M6.7 9h10.6l2.2 11H4.5Z" />
      <circle cx="12" cy="5.8" r="2.3" />
    </>
  ),
  stops: <path d="M6 4v16M6 5h11l-2.5 3.5L17 12H6" />,
  phone: <path d="M6.5 3.8h2.8l1.4 4.1-2 1.4a10.5 10.5 0 0 0 6 6l1.4-2 4.1 1.4v2.8a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 6a2 2 0 0 1 2-2.2Z" />,
  sparkle: <path d="M12 3.5c.6 4.6 3.9 7.9 8.5 8.5-4.6.6-7.9 3.9-8.5 8.5-.6-4.6-3.9-7.9-8.5-8.5 4.6-.6 7.9-3.9 8.5-8.5Z" />,
  locate: (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </>
  ),
  more: (
    <>
      <circle cx="12" cy="5.5" r=".9" />
      <circle cx="12" cy="12" r=".9" />
      <circle cx="12" cy="18.5" r=".9" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </>
  ),
  moon: <path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1Z" />,
  display: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M9 20h6M12 16.5V20" />
    </>
  ),
  arrowRight: <path d="M4.5 12h15M14 6.5l5.5 5.5-5.5 5.5" />,
  thermometer: (
    <>
      <path d="M10 13.5V5a2 2 0 0 1 4 0v8.5a4 4 0 1 1-4 0Z" />
      <path d="M12 10v6" />
    </>
  ),
  wifiOff: <path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M14.2 10.4A10 10 0 0 1 19 13M2 9.5a15 15 0 0 1 4.3-2.8M10.5 5.6A15 15 0 0 1 22 9.5M12 20h.01" />,
};

export default function Icon({ name, size = 20, strokeWidth = 1.6, className, title }) {
  const glyph = PATHS[name];
  if (!glyph) return null;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {glyph}
    </svg>
  );
}

// Brand mark: a stylised "s" bin-lid glyph echoing the Transcope 'T' mark.
export function LogoMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="6.5" cy="7" r="3.5" fill="currentColor" />
      <path d="M12 3.5h15.5a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5H21v17a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 14 27.5V12.6a5 5 0 0 0-2-4Z" fill="currentColor" />
    </svg>
  );
}
