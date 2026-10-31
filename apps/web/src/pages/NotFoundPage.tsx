import { Link } from 'react-router-dom';
import { Compass, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-2xl py-10">
      <EmptyState
        icon={Compass}
        title="That route does not exist"
        description="BlaxkVault only serves the screens it can actually implement. Use the navigation or the ⌘K palette to get where you were going."
        action={
          <Button asChild>
            <Link to="/">
              <Home className="size-4" aria-hidden />
              Back to Discover
            </Link>
          </Button>
        }
      />
    </div>
  );
}
