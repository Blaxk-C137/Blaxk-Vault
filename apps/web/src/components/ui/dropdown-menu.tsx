import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { CheckIcon, ChevronRightIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuSub = DropdownMenuPrimitive.Sub;

function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-44 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({ className, inset, variant = 'default', ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { inset?: boolean; variant?: 'default' | 'destructive' }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors',
        'focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        inset && 'pl-8',
        variant === 'destructive' && 'text-destructive focus:bg-destructive/15 focus:text-destructive',
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label className={cn('px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground', className)} {...props} />;
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

function DropdownMenuCheckboxItem({ className, children, checked, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      checked={checked}
      className={cn('relative flex cursor-default select-none items-center rounded-md py-1.5 pr-2 pl-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground', className)}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-3.5" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuSubTrigger({ className, children, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return (
    <DropdownMenuPrimitive.SubTrigger className={cn('flex cursor-default select-none items-center rounded-md px-2 py-1.5 text-sm outline-none focus:bg-accent', className)} {...props}>
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return <DropdownMenuPrimitive.SubContent className={cn('z-50 min-w-40 rounded-lg border border-border bg-popover p-1 shadow-xl', className)} {...props} />;
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem, DropdownMenuGroup, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent };
