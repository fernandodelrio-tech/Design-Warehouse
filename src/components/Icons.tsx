/** Inline 16px icons — no icon-font download, no network dependency. */

type Props = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const IconSearch = ({ size = 15 }: Props) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const IconClipboard = ({ size = 15 }: Props) => (
  <svg {...base(size)}>
    <path d="M9 4h6v3H9z" />
    <path d="M15 5.5h2A1.5 1.5 0 0 1 18.5 7v12A1.5 1.5 0 0 1 17 20.5H7A1.5 1.5 0 0 1 5.5 19V7A1.5 1.5 0 0 1 7 5.5h2" />
    <path d="M9 12h6M9 16h4" />
  </svg>
);

export const IconImage = ({ size = 15 }: Props) => (
  <svg {...base(size)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4 17 4.5-4.5 4 4L16 13l4 4" />
  </svg>
);

export const IconFolder = ({ size = 15 }: Props) => (
  <svg {...base(size)}>
    <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h3.6a1.5 1.5 0 0 1 1.2.6l.9 1.2H19a1.5 1.5 0 0 1 1.5 1.5v8.2A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />
  </svg>
);

export const IconCopy = ({ size = 15 }: Props) => (
  <svg {...base(size)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 5.5V5a1.5 1.5 0 0 0-1.5-1.5h-8A1.5 1.5 0 0 0 4 5v8.5A1.5 1.5 0 0 0 5.5 15H6" />
  </svg>
);

export const IconDownload = ({ size = 15 }: Props) => (
  <svg {...base(size)}>
    <path d="M12 4v11" />
    <path d="m7.5 11 4.5 4.5 4.5-4.5" />
    <path d="M4.5 19.5h15" />
  </svg>
);

export const IconUpload = ({ size = 15 }: Props) => (
  <svg {...base(size)}>
    <path d="M12 20V9" />
    <path d="m7.5 13 4.5-4.5L16.5 13" />
    <path d="M4.5 4.5h15" />
  </svg>
);

export const IconTrash = ({ size = 15 }: Props) => (
  <svg {...base(size)}>
    <path d="M4.5 7h15" />
    <path d="M9.5 7V5.5A1 1 0 0 1 10.5 4.5h3a1 1 0 0 1 1 1V7" />
    <path d="M6.5 7l.8 11.1a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
    <path d="M10.5 11v5M13.5 11v5" />
  </svg>
);

export const IconStar = ({ size = 15, filled = false }: Props & { filled?: boolean }) => (
  <svg {...base(size)} fill={filled ? 'currentColor' : 'none'}>
    <path d="m12 4.5 2.35 4.76 5.25.77-3.8 3.7.9 5.23L12 16.5l-4.7 2.46.9-5.23-3.8-3.7 5.25-.77z" />
  </svg>
);

export const IconClose = ({ size = 15 }: Props) => (
  <svg {...base(size)}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const IconSun = ({ size = 15 }: Props) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </svg>
);

export const IconMoon = ({ size = 15 }: Props) => (
  <svg {...base(size)}>
    <path d="M20 14.3A8 8 0 0 1 9.7 4a8.2 8.2 0 1 0 10.3 10.3z" />
  </svg>
);

export const IconSparkle = ({ size = 15 }: Props) => (
  <svg {...base(size)}>
    <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9z" />
    <path d="M18.5 16.5 19.2 18.6 21.3 19.3 19.2 20 18.5 22 17.8 20 15.7 19.3 17.8 18.6z" />
  </svg>
);

export const IconRefresh = ({ size = 15 }: Props) => (
  <svg {...base(size)}>
    <path d="M20 11a8 8 0 0 0-13.6-4.9L4 8.5" />
    <path d="M4 4.5v4h4" />
    <path d="M4 13a8 8 0 0 0 13.6 4.9L20 15.5" />
    <path d="M20 19.5v-4h-4" />
  </svg>
);
