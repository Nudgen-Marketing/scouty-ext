// The one renderer of the popup: a thin React view of the framework-free view model (ui/view.ts).
// It holds no logic about states; it draws what viewFor() returned.
import { useEffect, useRef, type KeyboardEvent } from "react";
import type { UiAction } from "../messages";
import { t } from "../ui/i18n";
import type { View, ViewAction } from "../ui/view";
import { Alert, Button, Icon, Logo, Progress, StatusPill, Working } from "./components";

export type PopupViewProps = { view: View; onAction: (action: UiAction) => void; reducedMotion?: boolean };

const HINT_ID = "action-hint";

function ActionButton({ action, onAction, primary }: { action: ViewAction; onAction: (action: UiAction) => void; primary?: boolean }) {
  // "Opens elsewhere" icons trail the label; the Stop icon leads it.
  const leading = action.id === "stop";
  return (
    <Button variant={action.variant} data-action={action.id} data-primary={primary ? "true" : undefined} onClick={() => onAction(action.id)}
      disabled={action.disabled} aria-describedby={action.disabled ? HINT_ID : undefined}
      className={action.variant === "link" ? "justify-start text-left" : "w-full"}>
      {action.icon && leading ? <Icon name={action.icon} /> : null}
      <span>{action.label}</span>
      {action.icon && !leading ? <Icon name={action.icon} /> : null}
    </Button>
  );
}

export function PopupView({ view, onAction, reducedMotion = false }: PopupViewProps) {
  const title = useRef<HTMLHeadingElement>(null);
  // Focus moves to the title when the screen changes, so a screen reader announces the new state
  // and the next Tab lands on the primary action.
  useEffect(() => {
    title.current?.focus();
  }, [view.kind]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (event.key === "Enter" && view.primary && !view.primary.disabled && target.tagName !== "BUTTON" && target.tagName !== "A") {
      event.preventDefault();
      onAction(view.primary.id);
    }
  };

  return (
    <div data-view={view.kind} data-view-number={view.n} onKeyDown={onKeyDown} className="flex max-h-[560px] w-[360px] flex-col overflow-y-auto bg-background text-foreground">
      <header className="flex min-h-12 items-center gap-2 border-b border-border px-4 py-2">
        <Logo />
        {view.workspace ? <span data-slot="workspace" className="min-w-0 flex-1 text-[13px] break-words text-muted-foreground">{view.workspace}</span> : <span className="flex-1" />}
        {view.showSettings ? (
          <Button variant="ghost" size="icon" aria-label={t("settingsButton")} data-action="openSettings" onClick={() => onAction("openSettings")}><Icon name="settings" /></Button>
        ) : null}
        {view.kind === "settings" ? (
          <Button variant="ghost" size="sm" data-action="closeSettings" onClick={() => onAction("closeSettings")}>{t("backButton")}</Button>
        ) : null}
      </header>

      <main className="grid gap-4 px-4 py-4">
        <Alert tone={view.tone}>
          {view.pill ? <div><StatusPill tone={view.pill.tone}>{view.pill.label}</StatusPill></div> : null}
          <h1 ref={title} tabIndex={-1} className="flex items-start gap-2 text-base leading-snug font-semibold break-words outline-none">
            {view.icon ? <Icon name={view.icon} className={view.tone === "alert" ? "mt-0.5 text-destructive" : "mt-0.5 text-pill-good-fg"} /> : null}
            <span>{view.title}</span>
          </h1>
          {view.bullets.length ? (
            <ul className="grid list-disc gap-1.5 pl-5 text-[13px] text-muted-foreground">{view.bullets.map((line, i) => <li key={i} className="break-words">{line}</li>)}</ul>
          ) : null}
          {view.body.map((line, i) => <p key={i} className="text-sm break-words text-muted-foreground">{line}</p>)}
          {view.progress ? (
            <div className="grid gap-1.5">
              <Progress value={view.progress.value} max={view.progress.max} valueText={view.progress.valueText} label={view.title} indeterminate={view.progress.indeterminate} reducedMotion={reducedMotion} />
              <p data-slot="progress-text" className="text-[13px] text-muted-foreground">{view.progress.indeterminate && reducedMotion ? t("working") : view.progress.text}</p>
            </div>
          ) : null}
          {view.working ? <Working label={t("working")} reducedMotion={reducedMotion} /> : null}
        </Alert>

        {view.steps.length ? (
          <ol data-slot="steps" className="grid gap-1 text-[13px]">
            {view.steps.map((step, i) => (
              <li key={i} data-status={step.status} aria-label={step.description} aria-current={step.status === "current" ? "step" : undefined}
                className={step.status === "waiting" ? "flex items-center gap-2 text-muted-foreground" : "flex items-center gap-2 text-foreground"}>
                <span aria-hidden="true" className="grid size-4 place-items-center">
                  {step.status === "done" ? <Icon name="check" className="text-pill-good-fg" /> : step.status === "current" ? <span className="size-2 rounded-full bg-primary" /> : <span className="size-1.5 rounded-full bg-input" />}
                </span>
                <span aria-hidden="true" className={step.status === "current" ? "font-medium" : undefined}>{step.label}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {view.estimate ? <p data-slot="estimate" className="text-[12px] text-muted-foreground">{view.estimate}</p> : null}

        {view.details.length ? (
          <dl className="grid gap-2 text-[13px]">
            {view.details.map((row, i) => (
              <div key={i} className="grid gap-0.5"><dt className="text-[12px] text-muted-foreground">{row.label}</dt><dd className="m-0 break-words">{row.value}</dd></div>
            ))}
          </dl>
        ) : null}

        {view.links.length ? <div className="grid justify-items-start gap-2">{view.links.map((link) => <ActionButton key={link.id} action={link} onAction={onAction} />)}</div> : null}

        {view.primary || view.secondary ? (
          <div data-slot="actions" className="grid gap-2">
            {view.primary ? <ActionButton action={view.primary} onAction={onAction} primary /> : null}
            {view.secondary ? <ActionButton action={view.secondary} onAction={onAction} /> : null}
          </div>
        ) : null}
        {view.hint ? <p id={HINT_ID} data-slot="hint" className="text-[13px] break-words text-muted-foreground">{view.hint}</p> : null}

        {view.footer ? <p data-slot="footer" className="text-[12px] text-muted-foreground">{view.footer}</p> : null}
      </main>
    </div>
  );
}
