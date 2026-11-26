import { describe, expect, it, vi } from "vitest";
import { singleFlight } from "../../src/background/single-flight";

describe("singleFlight (Disconnect pressed again while a sign-out runs)", () => {
  it("a call during a run joins it: the task runs once, both callers wait for the same end", async () => {
    let release!: () => void;
    const task = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const run = singleFlight(task);
    const first = run();
    const second = run();
    expect(second).toBe(first);
    expect(task).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
  });

  it("after a run ends, resolved or failed, the next call starts a new one", async () => {
    const task = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const run = singleFlight(task);
    await expect(run()).rejects.toThrow("offline");
    await run();
    await run();
    expect(task).toHaveBeenCalledTimes(3);
  });
});
