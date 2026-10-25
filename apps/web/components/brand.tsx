import { cn } from '@/lib/utils';

export function ShieldMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn('h-8 w-8', className)} aria-hidden fill="none">
      <path d="M24 4 40 10v12c0 11-7.2 19.6-16 22C15.2 41.6 8 33 8 22V10l16-6Z" fill="currentColor" opacity="0.18" />
      <path d="M24 4 40 10v12c0 11-7.2 19.6-16 22C15.2 41.6 8 33 8 22V10l16-6Z" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="m17 24 5 5 9-10" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className, light, name = 'CampusCare' }: { className?: string; light?: boolean; name?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-bold tracking-tight', light ? 'text-white' : 'text-forest', className)}>
      <ShieldMark className={light ? 'text-brand-300' : 'text-brand-600'} />
      <span className="text-lg">{name.replace('Care', '')}<span className={light ? 'text-brand-300' : 'text-brand-600'}>{name.includes('Care') ? 'Care' : ''}</span></span>
    </span>
  );
}
