import { useId } from 'react';
import { cn } from '@/lib/utils';
import { hyperBotToolProvider, type HyperBotToolProvider } from './HyperBotToolProvider';
type HyperBrandLogoProps = { size?: number; className?: string };

export function HyperOutlookLogo({ size = 14, className }: HyperBrandLogoProps) {
  const id = 'hyper-outlook-' + useId().replace(/:/g, '');
  return <svg width={size} height={size} viewBox="0 0 24 24" className={cn('hb-brand-logo', className)} aria-hidden="true" focusable="false" fill="none">
    <defs>
      <linearGradient id={id + '-mail'} x1="7" y1="3" x2="23" y2="22" gradientUnits="userSpaceOnUse"><stop stopColor="#28A8EA" /><stop offset="1" stopColor="#0364B8" /></linearGradient>
      <linearGradient id={id + '-plate'} x1="1" y1="6" x2="14" y2="20" gradientUnits="userSpaceOnUse"><stop stopColor="#0F6CBD" /><stop offset="1" stopColor="#0A2767" /></linearGradient>
    </defs>
    <rect x="8" y="2" width="13" height="16" rx="1.5" fill={`url(#${id}-mail)`} />
    <path d="M8 6h6v5H8z" fill="#50D9FF" /><path d="M14 6h7v5h-7z" fill="#28A8EA" /><path d="M14 11h7v6h-7z" fill="#0078D4" />
    <path d="M7 10.5 15 16l8-5.5V20a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z" fill={`url(#${id}-mail)`} />
    <path d="m7 11 8 5 8-5v1.5l-8 5-8-5z" fill="#0A64B0" /><path d="m7 21 7-5 9 5a2 2 0 0 1-2 1H9z" fill="#1490DF" />
    <rect x="1" y="6" width="13" height="15" rx="1.5" fill={`url(#${id}-plate)`} />
    <ellipse cx="7.5" cy="13.5" rx="2.8" ry="3.6" stroke="white" strokeWidth="1.7" />
  </svg>;
}

export function HyperJiraLogo({ size = 14, className }: HyperBrandLogoProps) {
  const id = 'hyper-jira-' + useId().replace(/:/g, '');
  return <svg width={size} height={size} viewBox="0 0 24 24" className={cn('hb-brand-logo', className)} aria-hidden="true" focusable="false" fill="none">
    <defs>
      <linearGradient id={id + '-mark'} x1="18" y1="4" x2="6" y2="21" gradientUnits="userSpaceOnUse"><stop stopColor="#2684FF" /><stop offset="1" stopColor="#0052CC" /></linearGradient>
      <linearGradient id={id + '-fold'} x1="6" y1="4" x2="12" y2="11" gradientUnits="userSpaceOnUse"><stop stopColor="#0052CC" /><stop offset="1" stopColor="#2684FF" /></linearGradient>
    </defs>
    <path fillRule="evenodd" d="M12 1.5 22.5 12 12 22.5 1.5 12 12 1.5Zm0 6.75L8.25 12 12 15.75 15.75 12 12 8.25Z" fill={`url(#${id}-mark)`} />
    <path d="m12 1.5-6.75 6.75 3 3L12 7.5l3-3z" fill={`url(#${id}-fold)`} />
    <path d="m12 22.5 6.75-6.75-3-3L12 16.5l-3 3z" fill={`url(#${id}-mark)`} />
  </svg>;
}

export function HyperBotProviderLogo({ provider, ...props }: HyperBrandLogoProps & { provider: HyperBotToolProvider | null }) {
  return provider === 'outlook' ? <HyperOutlookLogo {...props} /> : provider === 'jira' ? <HyperJiraLogo {...props} /> : null;
}
export function HyperBotToolLogo({ tool, ...props }: HyperBrandLogoProps & { tool: string }) {
  return <HyperBotProviderLogo provider={hyperBotToolProvider(tool)} {...props} />;
}
