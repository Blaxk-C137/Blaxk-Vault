import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva('relative flex w-full gap-3 rounded-lg border p-4 text-sm [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:translate-y-0.5', {
  variants: {
    variant: {
      default: 'border-border bg-card/60 text-foreground',
      info: 'border-status-downloading/35 bg-status-downloading/8 text-foreground',
      success: 'border-status-completed/35 bg-status-completed/8 text-foreground',
      warning: 'border-status-paused/35 bg-status-paused/8 text-foreground',
      destructive: 'border-status-failed/40 bg-status-failed/8 text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div role="alert" data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-title" className={cn('mb-0.5 font-medium leading-snug', className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-description" className={cn('text-sm text-muted-foreground leading-relaxed', className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription };
