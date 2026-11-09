import { useId } from 'react';

/** HyperTask mark, with an optional wordmark for app chrome. */
export function HyperLogo({ size = 36, wordmark = false }: { size?: number; wordmark?: boolean }) {
  const gradient = useId();
  return (
    <span aria-label="HyperTask" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--cs-on-surface)', whiteSpace: 'nowrap' }}>
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 40 40" fill="none">
        <defs><linearGradient id={gradient} x1="2" y1="2" x2="38" y2="38"><stop stopColor="#7357F5"/><stop offset="1" stopColor="#12A8D9"/></linearGradient></defs>
        <rect x="1" y="1" width="38" height="38" rx="12" fill={`url(#${gradient})`}/>
        <path d="M11 10h5v7.5h8V10h5v20h-5v-8h-8v8h-5z" fill="white"/>
      </svg>
      {wordmark && <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.03em' }}>HyperTask</span>}
    </span>
  );
}
