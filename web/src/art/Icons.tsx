/** Small line icons, drawn in the same flat style as the scene. */
const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const IconFolder = () => (
  <svg {...base} aria-hidden>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
);
export const IconScroll = () => (
  <svg {...base} aria-hidden>
    <path d="M7 4h11a2 2 0 0 1 2 2v1h-4M7 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7M7 4a2 2 0 0 1 2 2v0" />
    <path d="M9 10h6M9 14h6" />
  </svg>
);
export const IconPlay = () => (
  <svg {...base} aria-hidden>
    <path d="M7 5l11 7-11 7Z" fill="currentColor" stroke="none" />
  </svg>
);
export const IconDoc = () => (
  <svg {...base} aria-hidden>
    <path d="M6 3h8l4 4v14H6Z" />
    <path d="M14 3v4h4M9 12h6M9 16h6" />
  </svg>
);
export const IconClose = () => (
  <svg {...base} aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconGavel = () => (
  <svg {...base} aria-hidden>
    <path d="M13 4l7 7M11 6l7 7M14.5 9.5L5 19" />
    <path d="M3 21h9" />
  </svg>
);
export const IconSearch = () => (
  <svg {...base} aria-hidden>
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-4.5-4.5" />
  </svg>
);
export const IconMic = () => (
  <svg {...base} aria-hidden>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
  </svg>
);
export const IconSpeaker = ({ muted = false }: { muted?: boolean }) => (
  <svg {...base} aria-hidden>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" fill="currentColor" stroke="none" />
    {muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18.2 6.5a7.5 7.5 0 0 1 0 11" />}
  </svg>
);
