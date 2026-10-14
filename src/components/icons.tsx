import type { ReactNode } from 'react';

// A small line-icon set drawn here (no icon font, nothing loaded from the
// network). Icons are decoration next to text: always aria-hidden.
const PATHS = {
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  phone: <path d="M5.2 3.8h3.1l1.6 4.1-2 1.4a11.5 11.5 0 0 0 6.8 6.8l1.4-2 4.1 1.6v3.1a2 2 0 0 1-2.1 2A16.5 16.5 0 0 1 3.2 5.9a2 2 0 0 1 2-2.1z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  bolt: <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z" />,
  pin: (
    <>
      <path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.8" r="2.4" />
    </>
  ),
  device: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.2" />
      <path d="M10.5 18.5h3" />
    </>
  ),
  nodes: (
    <>
      <circle cx="5.5" cy="12" r="2.3" />
      <circle cx="18" cy="5.5" r="2.3" />
      <circle cx="18" cy="18.5" r="2.3" />
      <path d="m7.6 11 8.3-4.4M7.6 13l8.3 4.4" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeWidth="2.6" />
    </>
  ),
  message: <path d="M4.5 5h15a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H10l-5.5 4v-4h0a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />,
  moon: <path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6" />
      <path d="M16 4.8a3.2 3.2 0 0 1 0 6.4M18 14.3c1.8.7 3 2.7 3 5.7" />
    </>
  ),
  tower: (
    <>
      <path d="M8.5 21 12 10l3.5 11M9.6 17.5h4.8" />
      <circle cx="12" cy="8" r="1.6" />
      <path d="M8.3 4.5a5.2 5.2 0 0 0 0 7M15.7 4.5a5.2 5.2 0 0 1 0 7" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.5 1.5M9.5 2.5h5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z" />
    </>
  ),
  folder: <path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  idcard: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2.3" />
      <path d="M5.8 16.3c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M14.5 10h4M14.5 13.5h3" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 2.8 19.5h18.4z" />
      <path d="M12 10v4.5M12 17h.01" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** The app's mark: a gold-rimmed navy hexagon around a small link chart. */
export function Emblem({ size = 32 }: { size?: number }) {
  return (
    <svg className="emblem" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M16 1.8 28.3 8.9v14.2L16 30.2 3.7 23.1V8.9z" fill="var(--navy-700)" stroke="var(--gold)" strokeWidth="1.8" strokeLinejoin="round" />
      <g stroke="var(--gold-ink)" strokeWidth="1.4" strokeLinecap="round">
        <path d="M10.5 19.5 16 10.5l5.5 9zM16 10.5v5.8M10.5 19.5l5.5-3.2 5.5 3.2" />
      </g>
      <g fill="var(--gold-ink)">
        <circle cx="16" cy="10.5" r="2.2" />
        <circle cx="10.5" cy="19.5" r="2.2" />
        <circle cx="21.5" cy="19.5" r="2.2" />
        <circle cx="16" cy="16.3" r="1.5" fill="var(--on-navy)" />
      </g>
    </svg>
  );
}
