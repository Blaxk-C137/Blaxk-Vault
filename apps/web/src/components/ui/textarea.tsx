import * as React from 'react';
import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-20 w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm outline-none',
        'placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
