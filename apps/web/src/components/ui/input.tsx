import * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-9 w-full min-w-0 rounded-md border border-input bg-background/60 px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none',
        'placeholder:text-muted-foreground/70 selection:bg-primary selection:text-primary-foreground',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:mr-3 file:h-7 file:rounded file:border-0 file:bg-secondary file:px-2 file:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
