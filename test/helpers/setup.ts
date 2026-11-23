import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach } from "vitest";
import { fake, installFakeExt, resetFakeExt } from "./fake-ext";

installFakeExt();
const messages = JSON.parse(readFileSync(path.join(process.cwd(), "_locales/en/messages.json"), "utf8")) as Record<string, { message: string }>;
for (const [key, value] of Object.entries(messages)) fake.messages[key] = value.message;
beforeEach(() => resetFakeExt());
