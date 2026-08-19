import { clsx } from "clsx";
import { Loader2, X, Clapperboard } from "lucide-react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { useT } from "@/lib/i18n";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "quiet";
}) {
  const styles = {
    primary:
      "bg-ember text-ink hover:bg-ember/90 font-semibold shadow-[0_0_24px_rgba(242,163,60,0.25)]",
    ghost:
      "bg-panel-2 text-bone border border-line hover:border-ember/40 hover:text-ember",
    danger: "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25",
    quiet: "text-muted hover:text-bone",
  };
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-bone placeholder:text-muted/60 outline-none focus:border-ember/60 focus:ring-2 focus:ring-ember/20",
        props.className,
      )}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={clsx(
        "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-bone placeholder:text-muted/60 outline-none focus:border-ember/60 focus:ring-2 focus:ring-ember/20",
        props.className,
      )}
    />
  );
}

export function Select({
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={clsx(
        "w-full appearance-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-bone outline-none focus:border-ember/60",
        props.className,
      )}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[11px] tracking-widest text-muted uppercase">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "ember" | "danger" | "moss" | "dim";
  className?: string;
}) {
  const tones = {
    neutral: "border-line bg-panel-2 text-muted",
    ember: "border-ember/30 bg-ember-soft text-ember",
    danger: "border-danger/30 bg-danger/10 text-danger",
    moss: "border-moss/30 bg-moss/10 text-moss",
    dim: "border-line bg-transparent text-muted/70",
  };
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const t = useT();
  switch (status) {
    case "APPROVED":
      return <Badge tone="moss">{t("status.APPROVED")}</Badge>;
    case "PENDING_REVIEW":
      return <Badge tone="ember">{t("status.PENDING_REVIEW")}</Badge>;
    case "REJECTED":
      return <Badge tone="danger">{t("status.REJECTED")}</Badge>;
    case "PRIVATE":
      return <Badge>{t("status.PRIVATE")}</Badge>;
    case "PROCESSING":
      return <Badge tone="dim">{t("status.PROCESSING")}</Badge>;
    default:
      return <Badge tone="dim">{status}</Badge>;
  }
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label ? <span className="text-sm">{label}</span> : null}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-20 text-center">
      <Clapperboard className="mb-4 h-8 w-8 text-muted/50" strokeWidth={1.25} />
      <h3 className="font-display text-xl font-medium text-bone">{title}</h3>
      {body ? <p className="mt-2 max-w-sm text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={clsx(
          "rise max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-line bg-panel p-6 shadow-2xl",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <h2 className="font-display text-2xl font-medium">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted transition-colors hover:text-bone"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "rounded-2xl border border-line bg-panel",
        className,
      )}
      {...props}
    />
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </div>
  );
}
