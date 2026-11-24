// Small local components that mirror the app's patterns (src/components/ui in the app: button,
// status-pill, alert, skeleton) with the same measurements and tokens. Nothing is imported from
// the app, and no component library is used: these few have no behaviour a native element lacks.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { BRAND_LOGO_WIDTH, BRAND_MARK_PATHS, BRAND_WORD_PATHS } from "../ui/brand";
import { ICONS, type IconName } from "../ui/icons";
import type { ButtonVariant, PillTone } from "../ui/view";

export const cn = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(" ");

/** The app's focus ring: 2 px, --ring, 2 px offset, always visible on keyboard focus. */
const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const TRANSITION = "transition-[color,background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none";

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={cn("size-4 shrink-0", className)}>
      {ICONS[name].map((shape, i) => ("path" in shape ? <path key={i} d={shape.path} /> : <circle key={i} cx={shape.circle[0]} cy={shape.circle[1]} r={shape.circle[2]} />))}
    </svg>
  );
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:bg-primary-hover",
  outline: "border-border bg-background text-foreground shadow-xs hover:bg-muted active:bg-muted",
  ghost: "text-foreground hover:bg-muted active:bg-muted",
  link: "h-auto min-h-0 px-0 py-0 text-primary-strong underline-offset-4 hover:underline focus-visible:underline",
};
const SIZES = { sm: "min-h-8 gap-1.5 rounded-md px-3 py-1 text-[0.8125rem]", default: "min-h-9 gap-2 px-4 py-1.5", icon: "size-8 rounded-md" } as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: keyof typeof SIZES };

/** Heights 32 and 36 px as in the app. Labels wrap to two lines instead of being cut. */
export function Button({ variant = "primary", size = "default", className, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} data-variant={variant}
      className={cn(FOCUS, TRANSITION, "inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-center text-sm font-medium select-none disabled:pointer-events-none",
        // Disabled reads as inactive but stays legible (WCAG AA text contrast in both themes).
        "disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none",
        SIZES[size], VARIANTS[variant], className)}
      {...props} />
  );
}

const TONES: Record<PillTone, string> = {
  good: "bg-pill-good-bg text-pill-good-fg ring-pill-good-ring",
  active: "bg-pill-active-bg text-pill-active-fg ring-pill-active-ring",
  waiting: "bg-pill-waiting-bg text-pill-waiting-fg ring-pill-waiting-ring",
  problem: "bg-pill-problem-bg text-pill-problem-fg ring-pill-problem-ring",
  neutral: "bg-pill-neutral-bg text-pill-neutral-fg ring-pill-neutral-ring",
};

export function StatusPill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span data-tone={tone} className={cn("inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", TONES[tone])}>{children}</span>;
}

/** The message block. Errors are role="alert"; everything else is a polite live region. */
export function Alert({ tone, children }: { tone: "status" | "alert"; children: ReactNode }) {
  return (
    <div data-slot="message" role={tone === "alert" ? "alert" : "status"} aria-live={tone === "alert" ? "assertive" : "polite"} className="grid gap-2">
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div data-slot="skeleton" className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)} />;
}

type ProgressProps = { value: number; max: number; valueText: string; label: string; indeterminate: boolean; reducedMotion: boolean };

/** A progressbar with the count as its value text. While a page loads it shows a shimmer, or nothing moving under reduced motion. */
export function Progress({ value, max, valueText, label, indeterminate, reducedMotion }: ProgressProps) {
  const percent = max > 0 ? Math.round((Math.min(value, max) / max) * 100) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={indeterminate ? undefined : value} aria-valuetext={valueText}
      className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
      {indeterminate
        ? (reducedMotion ? null : <div data-slot="shimmer" className="absolute inset-y-0 left-0 w-1/3 animate-shimmer rounded-full bg-primary" />)
        : <div data-slot="bar" className={cn("h-full rounded-full bg-primary", TRANSITION, "transition-[width]")} style={{ width: `${percent}%` }} />}
    </div>
  );
}

/** The Scouty logo, as the app's Logo: the mark and the outlined wordmark in the text colour. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${BRAND_LOGO_WIDTH} 60`} fill="currentColor" role="img" aria-label="Scouty" focusable="false" data-slot="logo" className={cn("h-8 w-auto shrink-0 text-foreground", className)}>
      <g transform="translate(2 7)">{BRAND_MARK_PATHS.map((d) => <path key={d} d={d} />)}</g>
      {BRAND_WORD_PATHS.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/** A spinner, or under reduced motion a static label. */
export function Working({ label, reducedMotion }: { label: string; reducedMotion: boolean }) {
  if (reducedMotion) return <p data-slot="working-label" className="text-[13px] text-muted-foreground">{label}</p>;
  return <Icon name="loader" className="animate-spin text-muted-foreground" />;
}
