import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-secondary/40 p-1', className)} {...props} />;
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors',
        'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none',
        'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('mt-4 outline-none', className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
