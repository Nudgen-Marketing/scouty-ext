// Every user-visible string comes from _locales/en/messages.json through i18n.getMessage.
// The state gallery and the tests have no extension API, so they hand the same file in.
import { ext } from "../ext";

type Catalog = Record<string, { message: string }>;
let catalog: Catalog | null = null;

/** Use a messages.json object instead of the browser's i18n API (gallery, tests). */
export function useMessages(messages: Catalog | null): void {
  catalog = messages;
}

export function t(key: string, ...substitutions: (string | number)[]): string {
  const values = substitutions.map(String);
  if (catalog) {
    let text = catalog[key]?.message ?? "";
    values.forEach((value, i) => { text = text.split(`$${i + 1}`).join(value); });
    return text;
  }
  return ext.i18n.getMessage(key, values);
}
