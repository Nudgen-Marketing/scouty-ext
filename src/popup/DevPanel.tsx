// Development builds only: a "Developer" disclosure under Settings (and the signed-out screen, for
// the redirect URL before the first connect), collapsed by default. It shows the OAuth redirect
// URL and what the reader pressed on LinkedIn in the last captures (validation R4), with a copy
// button. popup.tsx renders it behind `__SCOUTY_DEV__`, so store builds drop this module and its
// strings; its text is not in messages.json for the same reason.
import { useEffect, useState } from "react";
import { summaryLine, type DevInfo } from "../dev-summary";
import { ext } from "../ext";
import type { Message } from "../messages";
import { Button } from "./components";

function report(info: DevInfo): string {
  const lines = [`Redirect URL: ${info.redirectUrl}`, `Captures in this browser session: ${info.captures.length}`];
  for (const capture of info.captures) {
    lines.push("", `${capture.at} ${capture.profile}`, summaryLine(capture));
    for (const entry of capture.entries) lines.push(`  ${entry.name} (${entry.selector}, ${entry.tag} in ${entry.container})`);
  }
  return lines.join("\n");
}

export function DevPanel() {
  const [info, setInfo] = useState<DevInfo | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void ext.runtime.sendMessage({ type: "dev:info" } satisfies Message).then((value) => setInfo(value as DevInfo), () => undefined);
  }, []);
  if (!info) return null;
  const text = report(info);
  return (
    <details data-slot="developer" className="mx-4 mb-4 rounded-md border border-border p-2 text-[12px] text-muted-foreground">
      <summary className="cursor-pointer select-none">Developer</summary>
      <div className="mt-2 grid gap-2">
        <pre className="max-h-48 overflow-auto break-all whitespace-pre-wrap">{text}</pre>
        <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true), () => undefined)}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </details>
  );
}
