// A section that could not show its numbers: not for this role, or a failed
// load that can be retried.

import { Button } from './ui/index.tsx';
import type { LoadFailure } from './load-state.ts';

export function Notice({ failure, onRetry }: { failure: LoadFailure; onRetry: () => void }) {
  if (failure.kind === 'forbidden') return <p className="admin-note">Этот раздел недоступен вашей роли.</p>;
  return (
    <>
      <p className="admin-error" role="alert">
        {failure.message}
      </p>
      <Button onClick={onRetry}>Повторить</Button>
    </>
  );
}
