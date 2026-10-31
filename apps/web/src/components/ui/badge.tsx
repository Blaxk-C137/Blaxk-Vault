import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide transition-colors [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-primary/40 bg-primary/12 text-primary',
        neutral: 'border-border bg-secondary/60 text-muted-foreground',
        outline: 'border-border text-foreground/80',
        success: 'border-status-completed/40 bg-status-completed/12 text-status-completed',
        warning: 'border-status-paused/40 bg-status-paused/12 text-status-paused',
        danger: 'border-status-failed/40 bg-status-failed/12 text-status-failed',
        info: 'border-status-downloading/40 bg-status-downloading/12 text-status-downloading',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
