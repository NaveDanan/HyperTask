import logo from '@resources/hypertask-logo.svg';

/** HyperTask mark, with an optional wordmark for app chrome. */
export function HyperLogo({ size = 36, wordmark = false }: { size?: number; wordmark?: boolean }) {
  return (
    <span aria-label="HyperTask" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--cs-on-surface)', whiteSpace: 'nowrap' }}>
      <span aria-hidden="true" style={{ display: 'inline-block', width: size, height: size, flexShrink: 0, backgroundColor: 'var(--hyper-logo-color)', mask: `url(${logo}) center / contain no-repeat`, WebkitMask: `url(${logo}) center / contain no-repeat` }} />
      {wordmark && <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.03em' }}>HyperTask</span>}
    </span>
  );
}
