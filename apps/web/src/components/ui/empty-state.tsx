import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shared empty/error presentation. Empty states always explain what would fill
 * them, so a blank screen is never mistaken for a broken one.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  tone = 'neutral',
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  tone?: 'neutral' | 'error';
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 px-6 py-14 text-center', className)}>
      {Icon ? <Icon className={cn('size-7', tone === 'error' ? 'text-status-failed' : 'text-muted-foreground')} aria-hidden /> : null}
      <div className="space-y-1.5">
        <h3 className="text-base font-semibold">{title}</h3>
        {description ? <p className="mx-auto max-w-md text-sm text-muted-foreground text-balance">{description}</p> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
