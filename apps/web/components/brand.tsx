import { cn } from '@/lib/utils';

export function ShieldMark({
  className,
  light = false,
  monochrome = false,
}: {
  className?: string;
  light?: boolean;
  monochrome?: boolean;
}) {
  const shieldColor = monochrome ? 'currentColor' : light ? '#FFFFFF' : '#064E3B';
  const personColor = monochrome ? 'currentColor' : light ? '#A7F3D0' : '#10B981';
  const sparkColor = monochrome ? 'currentColor' : '#F59E0B';

  return (
    <svg
      viewBox="0 0 100 100"
      className={cn('h-8 w-8 shrink-0', className)}
      aria-hidden="true"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Open Shield 'C' */}
      <path
        d="M 68 20.5 L 45 13 L 20 20.5 L 20 50 C 20 67 32 80 45 86 C 54.5 81.5 61.5 74.5 64 66.5"
        stroke={shieldColor}
        strokeWidth="12.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Person Head */}
      <circle cx="45" cy="33.5" r="7.8" fill={personColor} />
      {/* Person Body (Heart) */}
      <path
        d="M 45 46.5 C 43 42.5 32 38.5 29 45.5 C 25 54 34 63.5 45 72.5 C 56 63.5 65 54 61 45.5 C 58 38.5 47 42.5 45 46.5 Z"
        fill={personColor}
      />
      {/* Spark */}
      <path
        d="M 71 34 Q 71 43 80 43 Q 71 43 71 52 Q 71 43 62 43 Q 71 43 71 34 Z"
        fill={sparkColor}
      />
    </svg>
  );
}

export function Logo({
  className,
  light,
  name = 'CampusCare',
  tagline,
}: {
  className?: string;
  light?: boolean;
  name?: string;
  tagline?: boolean | string;
}) {
  const isDefaultName = name === 'CampusCare';
  const campusPart = isDefaultName ? 'Campus' : name.replace('Care', '');
  const carePart = isDefaultName ? 'Care' : name.includes('Care') ? 'Care' : '';

  return (
    <div className={cn('inline-flex flex-col', className)}>
      <span
        className={cn(
          'inline-flex items-center gap-2.5 font-extrabold tracking-tight select-none',
          light ? 'text-white' : 'text-[#082A20]'
        )}
      >
        <ShieldMark className="h-8 w-8" light={light} />
        <span className="text-xl font-extrabold tracking-tight">
          <span>{campusPart}</span>
          <span className={light ? 'text-[#34D399]' : 'text-[#10B981]'}>{carePart}</span>
        </span>
      </span>
      {tagline && (
        <span
          className={cn(
            'text-[11px] font-semibold tracking-wide pl-10 -mt-1',
            light ? 'text-emerald-200/80' : 'text-slate-500'
          )}
        >
          {typeof tagline === 'string' ? tagline : 'Help is one hold away'}
        </span>
      )}
    </div>
  );
}

export function StackedLogo({
  className,
  light,
  markSize = 'h-16 w-16',
  tagline = true,
}: {
  className?: string;
  light?: boolean;
  markSize?: string;
  tagline?: boolean;
}) {
  return (
    <div className={cn('flex flex-col items-center text-center', className)}>
      <ShieldMark className={cn(markSize, 'mb-3')} light={light} />
      <span
        className={cn(
          'text-2xl font-extrabold tracking-tight',
          light ? 'text-white' : 'text-[#082A20]'
        )}
      >
        Campus<span className={light ? 'text-[#34D399]' : 'text-[#10B981]'}>Care</span>
      </span>
      {tagline && (
        <span
          className={cn(
            'mt-1 text-xs font-medium tracking-wide',
            light ? 'text-emerald-100/90' : 'text-slate-500'
          )}
        >
          Help is one hold away
        </span>
      )}
    </div>
  );
}
