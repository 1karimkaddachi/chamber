import {
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  Info,
  Loader2,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';
import { initials } from '../lib/format';

export function cn(...values: Array<string | false | null | undefined>) {
  return clsx(values);
}

// ─────────────────────────────────────────────────────────────
// Buttons
// ─────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const buttonVariants: Record<Variant, string> = {
  primary:
    'accent-gradient text-white shadow-[0_10px_30px_-12px_rgba(124,108,255,0.9)] hover:brightness-110 border border-white/10',
  secondary:
    'bg-white/[0.055] text-ink border border-white/10 hover:bg-white/[0.09] hover:border-white/15 shadow-sm',
  outline: 'bg-transparent text-soft border border-white/12 hover:bg-white/5 hover:text-ink',
  ghost: 'bg-transparent text-muted hover:bg-white/5 hover:text-ink border border-transparent',
  danger: 'bg-rose/12 text-rose border border-rose/25 hover:bg-rose/20',
  success: 'bg-mint/12 text-mint border border-mint/25 hover:bg-mint/20',
};

const buttonSizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs rounded-lg gap-1.5',
  md: 'h-10 px-4 text-sm rounded-xl gap-2',
  lg: 'h-11 px-5 text-sm rounded-xl gap-2',
  icon: 'h-9 w-9 rounded-xl',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  leftIcon: Left,
  rightIcon: Right,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : Left ? <Left size={15} /> : null}
      {children}
      {Right && !loading ? <Right size={15} /> : null}
    </button>
  );
}

export function IconButton({
  label,
  icon: Icon,
  variant = 'ghost',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon; variant?: Variant }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-muted transition hover:bg-white/6 hover:text-ink',
        variant === 'danger' && 'hover:bg-rose/10 hover:text-rose',
        className,
      )}
      {...props}
    >
      <Icon size={16} />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Form controls
// ─────────────────────────────────────────────────────────────

const inputBase =
  'w-full rounded-xl border border-white/10 bg-white/[0.035] px-3.5 py-2.5 text-sm text-ink placeholder:text-faint transition focus:border-accent/55 focus:bg-white/[0.05] focus:outline-none focus:ring-4 focus:ring-accent/10 disabled:cursor-not-allowed disabled:opacity-50';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputBase, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputBase, 'min-h-24 resize-y leading-relaxed', className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn(inputBase, 'appearance-none pr-9', className)} {...props}>
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint" />
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
  action,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
  action?: ReactNode;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-soft">
          {label}
        </label>
        {action}
      </div>
      {children}
      {error ? (
        <p className="text-xs text-rose">{error}</p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  description,
  hideLabel = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
  hideLabel?: boolean;
}) {
  const button = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'border-accent/40 bg-accent/80 shadow-[0_0_20px_-4px_rgba(124,108,255,0.8)]'
          : 'border-white/10 bg-white/8',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
  if (!label || hideLabel) return button;
  return (
    <div className="flex items-center justify-between gap-6 rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        {description ? <p className="mt-0.5 text-xs leading-relaxed text-faint">{description}</p> : null}
      </div>
      {button}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Surfaces & typography
// ─────────────────────────────────────────────────────────────

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('glass rounded-2xl', className)} {...props}>
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  badge,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 border-b border-white/6 pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 animate-fade-up">
        {eyebrow ? <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-accent-soft/80">{eyebrow}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[30px]">{title}</h1>
          {badge}
        </div>
        {description ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionCard({
  icon: Icon,
  title,
  description,
  actions,
  children,
  className,
  accent = 'accent',
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  accent?: 'accent' | 'cyan' | 'mint' | 'amber' | 'rose';
}) {
  const accents: Record<string, string> = {
    accent: 'from-accent/25 to-accent/5 text-accent-soft border-accent/20',
    cyan: 'from-cyan/20 to-cyan/5 text-cyan border-cyan/20',
    mint: 'from-mint/20 to-mint/5 text-mint border-mint/20',
    amber: 'from-amber/20 to-amber/5 text-amber border-amber/20',
    rose: 'from-rose/20 to-rose/5 text-rose border-rose/20',
  };
  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="flex flex-col gap-3 border-b border-white/6 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          {Icon ? (
            <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border bg-gradient-to-br', accents[accent])}>
              <Icon size={17} />
            </div>
          ) : null}
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {description ? <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent = 'accent',
  badge,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: 'accent' | 'cyan' | 'mint' | 'amber' | 'rose';
  badge?: ReactNode;
}) {
  const accents: Record<string, string> = {
    accent: 'bg-accent/12 text-accent-soft border-accent/20',
    cyan: 'bg-cyan/10 text-cyan border-cyan/20',
    mint: 'bg-mint/10 text-mint border-mint/20',
    amber: 'bg-amber/10 text-amber border-amber/20',
    rose: 'bg-rose/10 text-rose border-rose/20',
  };
  return (
    <Card className="group relative overflow-hidden p-5 card-hover">
      <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-white/[0.02] blur-2xl transition group-hover:bg-white/[0.04]" />
      <div className="flex items-start justify-between gap-3">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl border', accents[accent])}>
          <Icon size={18} />
        </div>
        {badge}
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-tight text-ink">{value}</p>
      <p className="mt-1 text-xs font-medium uppercase tracking-wider text-faint">{label}</p>
      {hint ? <p className="mt-2 text-xs text-muted">{hint}</p> : null}
    </Card>
  );
}

export function Badge({
  children,
  tone = 'muted',
  className,
}: {
  children: ReactNode;
  tone?: 'muted' | 'accent' | 'mint' | 'cyan' | 'amber' | 'rose';
  className?: string;
}) {
  const tones: Record<string, string> = {
    muted: 'bg-white/6 text-soft border-white/10',
    accent: 'bg-accent/12 text-accent-soft border-accent/25',
    mint: 'bg-mint/10 text-mint border-mint/25',
    cyan: 'bg-cyan/10 text-cyan border-cyan/25',
    amber: 'bg-amber/10 text-amber border-amber/25',
    rose: 'bg-rose/10 text-rose border-rose/25',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-5',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Overlays
// ─────────────────────────────────────────────────────────────

const modalSizes: Record<string, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-3 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'glass relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-3xl animate-fade-up',
          modalSizes[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/7 px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold text-ink">{title}</h2>
            {description ? <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p> : null}
          </div>
          <IconButton label="Close" icon={X} onClick={onClose} />
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? <div className="border-t border-white/7 bg-white/[0.015] px-6 py-4">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80]">
      <button
        type="button"
        aria-label="Close panel"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside
        className="glass absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-white/10 shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/7 px-6 py-5">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-ink">{title}</h2>
            {subtitle ? <div className="mt-1 text-sm text-muted">{subtitle}</div> : null}
          </div>
          <IconButton label="Close" icon={X} onClick={onClose} />
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? <div className="border-t border-white/7 bg-white/[0.015] px-6 py-4">{footer}</div> : null}
      </aside>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────
// Misc
// ─────────────────────────────────────────────────────────────

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ value: T; label: string; count?: number }>;
  className?: string;
}) {
  return (
    <div className={cn('inline-flex flex-wrap items-center gap-1 rounded-xl border border-white/8 bg-white/[0.025] p-1', className)}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition',
            value === item.value
              ? 'bg-white/10 text-ink shadow-sm'
              : 'text-muted hover:bg-white/5 hover:text-soft',
          )}
        >
          {item.label}
          {item.count !== undefined ? (
            <span className="rounded-full bg-white/8 px-1.5 text-[10px] text-soft">{item.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-14 text-center', className)}>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-muted">
        <Icon size={22} />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-ink">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('shimmer rounded-xl', className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('animate-spin text-accent-soft', className)} size={20} />;
}

export function PageLoader() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
      <Spinner className="h-7 w-7" />
      <p className="text-xs uppercase tracking-[0.2em] text-faint">Loading chamber</p>
    </div>
  );
}

export function SaveBar({
  dirty,
  saving,
  onSave,
  onReset,
  note,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
  note?: ReactNode;
}) {
  if (!dirty) {
    return (
      <div className="flex items-center justify-end gap-2 pt-1 text-[11px] text-faint">
        <span className="h-1.5 w-1.5 rounded-full bg-mint" />
        {note ?? 'All changes are saved.'}
      </div>
    );
  }
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-3 rounded-2xl border border-white/12 bg-[#0b0b16]/95 px-4 py-3 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.95)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-xs text-soft">
        <span className="h-2 w-2 rounded-full bg-amber animate-pulse-soft" />
        You have unsaved changes.
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onReset} disabled={saving}>
          Reset
        </Button>
        <Button variant="primary" size="sm" onClick={onSave} loading={saving}>
          Save changes
        </Button>
      </div>
    </div>
  );
}

export function OfflineNotice({ message, className }: { message?: string; className?: string }) {
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border border-amber/25 bg-amber/[0.07] px-4 py-3', className)}>
      <WifiOff size={16} className="mt-0.5 shrink-0 text-amber" />
      <div>
        <p className="text-xs font-medium text-amber">Bot offline — configuration still saves</p>
        <p className="mt-0.5 text-xs leading-relaxed text-amber/70">
          {message ?? 'Start the bot with a Discord token to apply live room actions.'}
        </p>
      </div>
    </div>
  );
}

export function Callout({
  tone = 'accent',
  icon: Icon = Info,
  title,
  children,
}: {
  tone?: 'accent' | 'cyan' | 'mint' | 'amber' | 'rose';
  icon?: LucideIcon;
  title?: string;
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    accent: 'border-accent/25 bg-accent/[0.06] text-accent-soft',
    cyan: 'border-cyan/25 bg-cyan/[0.06] text-cyan',
    mint: 'border-mint/25 bg-mint/[0.06] text-mint',
    amber: 'border-amber/25 bg-amber/[0.06] text-amber',
    rose: 'border-rose/25 bg-rose/[0.06] text-rose',
  };
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border px-4 py-3.5', tones[tone])}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 text-xs leading-relaxed">
        {title ? <p className="mb-0.5 font-semibold text-ink">{title}</p> : null}
        <div className="text-soft/90">{children}</div>
      </div>
    </div>
  );
}

export function Progress({ value, max, tone = 'accent' }: { value: number; max: number; tone?: 'accent' | 'cyan' | 'mint' | 'amber' }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tones: Record<string, string> = {
    accent: 'from-accent to-cyan',
    cyan: 'from-cyan to-accent',
    mint: 'from-mint to-cyan',
    amber: 'from-amber to-rose',
  };
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
      <div
        className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-500', tones[tone])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function Avatar({
  src,
  name,
  size = 36,
  className,
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const label = useMemo(() => initials(name), [name]);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name ?? 'User avatar'}
        width={size}
        height={size}
        className={cn('shrink-0 rounded-full object-cover ring-1 ring-white/10', className)}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/40 to-cyan/20 text-xs font-semibold text-white ring-1 ring-white/10',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {label}
    </div>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      leftIcon={copied ? Check : Copy}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          // Clipboard can be unavailable; no-op.
        }
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}

export function CodeBlock({ code, maxHeight = '420px' }: { code: string; maxHeight?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/8 bg-black/40">
      <div className="flex items-center justify-between border-b border-white/6 px-3 py-2">
        <span className="text-[11px] uppercase tracking-wider text-faint">JSON</span>
        <CopyButton value={code} />
      </div>
      <pre className="scroll-thin overflow-auto p-4 text-[11.5px] leading-relaxed text-soft/90" style={{ maxHeight }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function AlertInline({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-rose/20 bg-rose/[0.06] px-3 py-2 text-xs text-rose">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
