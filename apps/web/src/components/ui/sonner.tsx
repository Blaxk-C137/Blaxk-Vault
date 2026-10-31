import { Toaster as SonnerToaster, type ToasterProps } from 'sonner';
import { useUiStore } from '@/store/ui';

/** Toast surface (sonner, MIT). Follows the app theme rather than the OS default. */
export function Toaster(props: ToasterProps) {
  const theme = useUiStore((state) => state.theme);
  const resolved = theme === 'system' ? 'system' : theme;
  return (
    <SonnerToaster
      theme={resolved}
      position="bottom-right"
      closeButton
      richColors
      toastOptions={{
        classNames: {
          toast: 'surface-raised text-foreground rounded-lg border-border',
          description: 'text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}
