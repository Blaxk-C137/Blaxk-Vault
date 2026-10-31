import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { SearchIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

/**
 * shadcn/ui Command — documentation: https://ui.shadcn.com/docs/components/command
 * Built on cmdk (github.com/dip/cmdk, MIT). Used for the ⌘K palette, which is
 * keyboard-first by construction: arrow keys move, Enter opens, Escape closes.
 */
const Command = React.forwardRef<React.ElementRef<typeof CommandPrimitive>, React.ComponentPropsWithoutRef<typeof CommandPrimitive>>(
  ({ className, ...props }, ref) => (
    <CommandPrimitive ref={ref} className={cn('flex h-full w-full flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground', className)} {...props} />
  ),
);
Command.displayName = 'Command';

function CommandDialog({ children, title = 'Command palette', description = 'Search and run a command', ...props }: React.ComponentProps<typeof Dialog> & { title?: string; description?: string }) {
  return (
    <Dialog {...props}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl" aria-describedby={description}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-1.5 [&_[cmdk-item]]:px-2.5 [&_[cmdk-item]]:py-2">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3.5" cmdk-input-wrapper="">
      <SearchIcon className="size-4 shrink-0 opacity-60" />
      <CommandPrimitive.Input
        className={cn('flex h-11 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground/70 disabled:opacity-50', className)}
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List className={cn('max-h-80 overflow-y-auto overflow-x-hidden py-1.5 scrollbar-thin', className)} {...props} />;
}

function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty className="py-8 text-center text-sm text-muted-foreground" {...props} />;
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return <CommandPrimitive.Group className={cn('overflow-hidden text-foreground', className)} {...props} />;
}

function CommandSeparator({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return <CommandPrimitive.Separator className={cn('-mx-1.5 my-1 h-px bg-border', className)} {...props} />;
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'relative flex cursor-default select-none items-center gap-2.5 rounded-md text-sm outline-none',
        'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}

function CommandShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn('ml-auto text-[11px] tracking-widest text-muted-foreground', className)} {...props} />;
}

export { Command, CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut, CommandSeparator };
