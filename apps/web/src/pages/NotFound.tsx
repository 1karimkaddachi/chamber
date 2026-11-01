import { ArrowLeft, Ghost } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-muted">
        <Ghost size={26} />
      </div>
      <p className="mt-6 text-[11px] uppercase tracking-[0.3em] text-faint">404 · Not found</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">This room does not exist</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
        The page may have moved, or the room was deleted while you were looking at it.
      </p>
      <Button variant="primary" className="mt-6" leftIcon={ArrowLeft} onClick={() => navigate(-1)}>
        Go back
      </Button>
    </div>
  );
}

export default NotFoundPage;
