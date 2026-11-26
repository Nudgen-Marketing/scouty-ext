import { describe, expect, it } from "vitest";
import { clearWake, onWake, RETRY_ALARM, wakeAt } from "../../src/background/wake";
import { fake } from "../helpers/fake-ext";

describe("the retry alarm through the ext wrapper", () => {
  it("wakeAt sets one named alarm at the given time and replaces it; clearWake removes it", async () => {
    wakeAt(1_000);
    wakeAt(61_000);
    await Promise.resolve();
    expect([...fake.alarms]).toEqual([[RETRY_ALARM, 61_000]]);
    clearWake();
    await Promise.resolve();
    expect(fake.alarms.size).toBe(0);
    expect(fake.alarmCalls.map((c) => c.op)).toEqual(["create", "create", "clear"]);
  });

  it("onWake runs only for the retry alarm", () => {
    let woken = 0;
    onWake(() => { woken += 1; });
    fake.alarms.set("other", 5);
    fake.fireAlarm("other");
    expect(woken).toBe(0);
    wakeAt(10);
    fake.fireAlarm(RETRY_ALARM);
    expect(woken).toBe(1);
  });
});
