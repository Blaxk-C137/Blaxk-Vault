import { cn } from '@/lib/utils';

/** Loading placeholder. Only used where a real request is in flight. */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('animate-pulse rounded-md bg-muted/70', className)} {...props} />;
}

export { Skeleton };
