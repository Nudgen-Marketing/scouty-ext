import { beforeEach, describe, expect, it } from "vitest";
import { chooseAppTab, openAppPage } from "../../src/background/app-tab";
import { fake, type FakeTab } from "../helpers/fake-ext";

const SCOUTY = "https://scouty.to/*";
const LINKEDIN = "https://www.linkedin.com/in/*";
const TARGET = "https://scouty.to/campaigns/c1?linkedin=synthetic-person-one&person=p1";
const LINKEDIN_TAB = 10;

const tab = (t: FakeTab): FakeTab => { fake.tabList.push(t); return t; };
const linkedinTab = (extra: Partial<FakeTab> = {}): FakeTab =>
  tab({ id: LINKEDIN_TAB, url: "https://www.linkedin.com/in/synthetic-person-one/", windowId: 1, lastAccessed: 100, ...extra });

/** What happened to the tabs: navigated (tab id and url), focused windows, created tabs. */
const outcome = () => ({
  updated: fake.updatedTabs.map((u) => [u.tabId, u.props.url, u.props.active]),
  focused: [...fake.focusedWindows],
  created: [...fake.createdTabs],
});

describe("returning to the Scouty app tab", () => {
  beforeEach(() => {
    fake.granted.add(LINKEDIN);
    fake.granted.add(SCOUTY);
  });

  it("a. reuses the app tab that opened the LinkedIn tab, even when another Scouty tab is on the target page", async () => {
    tab({ id: 3, url: "https://scouty.to/campaigns/c1?view=leads", windowId: 2, lastAccessed: 50 });
    tab({ id: 4, url: "https://scouty.to/campaigns/c9", windowId: 1, lastAccessed: 90 });
    linkedinTab({ openerTabId: 4 });
    await openAppPage(TARGET, LINKEDIN_TAB);
    expect(outcome()).toEqual({ updated: [[4, TARGET, true]], focused: [1], created: [] });
  });

  it("b. without a Scouty opener, reuses a Scouty tab on the target's path, ignoring its query, in any window", async () => {
    tab({ id: 3, url: "https://scouty.to/settings", windowId: 1, lastAccessed: 99 });
    tab({ id: 5, url: "https://scouty.to/campaigns/c1?tab=old", windowId: 2, lastAccessed: 20 });
    linkedinTab();
    await openAppPage(TARGET, LINKEDIN_TAB);
    expect(outcome()).toEqual({ updated: [[5, TARGET, true]], focused: [2], created: [] });
  });

  it("c. otherwise the most recently used Scouty tab in the LinkedIn tab's window", async () => {
    tab({ id: 3, url: "https://scouty.to/settings", windowId: 1, lastAccessed: 10 });
    tab({ id: 4, url: "https://scouty.to/dashboard", windowId: 1, lastAccessed: 80 });
    tab({ id: 6, url: "https://scouty.to/inbox", windowId: 2, lastAccessed: 999 });
    linkedinTab();
    await openAppPage(TARGET, LINKEDIN_TAB);
    expect(outcome()).toEqual({ updated: [[4, TARGET, true]], focused: [1], created: [] });
  });

  it("c. with no LinkedIn tab known, the last focused window", async () => {
    tab({ id: 4, url: "https://scouty.to/dashboard", windowId: 1, lastAccessed: 80 });
    tab({ id: 6, url: "https://scouty.to/inbox", windowId: 2, lastAccessed: 70 });
    fake.lastFocusedWindow = 2;
    await openAppPage(TARGET, null);
    expect(outcome()).toEqual({ updated: [[6, TARGET, true]], focused: [2], created: [] });
  });

  it("d. no Scouty tab: a new tab, as before", async () => {
    tab({ id: 7, url: "https://example.org/campaigns/c1", windowId: 1, lastAccessed: 5 });
    linkedinTab({ openerTabId: 7 });
    await openAppPage(TARGET, LINKEDIN_TAB);
    expect(outcome()).toEqual({ updated: [], focused: [], created: [TARGET] });
  });

  it("d. a Scouty tab only in another window, on another page: a new tab", async () => {
    tab({ id: 6, url: "https://scouty.to/inbox", windowId: 2, lastAccessed: 999 });
    linkedinTab();
    await openAppPage(TARGET, LINKEDIN_TAB);
    expect(outcome()).toEqual({ updated: [], focused: [], created: [TARGET] });
  });

  it("an opener on LinkedIn or another site is not reused", async () => {
    tab({ id: 2, url: "https://www.linkedin.com/in/someone-else/", windowId: 1, lastAccessed: 70 });
    linkedinTab({ openerTabId: 2 });
    expect(await chooseAppTab(TARGET, LINKEDIN_TAB)).toBeNull();
    fake.tabList.length = 0;
    tab({ id: 2, url: "https://scouty.to.example.org/campaigns/c1", windowId: 1, lastAccessed: 70 });
    tab({ id: 9, url: "http://scouty.to/campaigns/c1", windowId: 1, lastAccessed: 70 });
    linkedinTab({ openerTabId: 2 });
    await openAppPage(TARGET, LINKEDIN_TAB);
    expect(outcome()).toEqual({ updated: [], focused: [], created: [TARGET] });
  });

  it("an opener that no longer exists falls through to the next choice", async () => {
    tab({ id: 5, url: "https://scouty.to/campaigns/c1", windowId: 1, lastAccessed: 20 });
    linkedinTab({ openerTabId: 42 });
    await openAppPage(TARGET, LINKEDIN_TAB);
    expect(outcome().updated).toEqual([[5, TARGET, true]]);
  });

  it("Scouty origin permission missing (Firefox lets the user withhold it): a new tab, no tab read or navigated", async () => {
    fake.granted.delete(SCOUTY);
    tab({ id: 4, url: "https://scouty.to/campaigns/c1", windowId: 1, lastAccessed: 80 });
    linkedinTab({ openerTabId: 4 });
    await openAppPage(TARGET, LINKEDIN_TAB);
    expect(outcome()).toEqual({ updated: [], focused: [], created: [TARGET] });
  });

  it("the LinkedIn tab is never navigated, whatever is open", async () => {
    linkedinTab({ openerTabId: LINKEDIN_TAB });
    tab({ id: 11, url: "https://www.linkedin.com/in/other/", windowId: 1, lastAccessed: 500 });
    await openAppPage(TARGET, LINKEDIN_TAB);
    tab({ id: 4, url: "https://scouty.to/dashboard", windowId: 1, lastAccessed: 80 });
    await openAppPage(TARGET, LINKEDIN_TAB);
    expect(fake.updatedTabs.map((u) => u.tabId)).toEqual([4]);
    expect(fake.tabList.find((t) => t.id === LINKEDIN_TAB)!.url).toBe("https://www.linkedin.com/in/synthetic-person-one/");
    expect(fake.createdTabs).toEqual([TARGET]);
  });

  it("an address off the Scouty origin always gets a new tab", async () => {
    tab({ id: 4, url: "https://scouty.to/dashboard", windowId: 1, lastAccessed: 80 });
    linkedinTab({ openerTabId: 4 });
    await openAppPage("https://store.example.org/scouty", LINKEDIN_TAB);
    expect(outcome()).toEqual({ updated: [], focused: [], created: ["https://store.example.org/scouty"] });
  });
});
