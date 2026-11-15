const { IMPULSE_PHRASES, COMMIT_PHRASES } = require("../src/shared/defaults");

describe("pause page headings", () => {
  test("there are several, all unique", () => {
    expect(IMPULSE_PHRASES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(IMPULSE_PHRASES).size).toBe(IMPULSE_PHRASES.length);
  });

  test("short enough for one line and no trailing period", () => {
    for (const p of IMPULSE_PHRASES) {
      expect(p.length).toBeLessThanOrEqual(42);
      expect(p).not.toMatch(/\.$/);
      expect(p).toBe(p.trim());
    }
  });
});

describe("remove-site sentences", () => {
  const { REMOVE_SITE_PHRASES } = require("../src/shared/defaults");
  const { phrasesFor, isCommitPhrase } = require("../src/shared/friction");
  const remove = { type: "removeSite", domain: "youtube.com" };

  test("each names the site exactly once and is unique", () => {
    expect(REMOVE_SITE_PHRASES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(REMOVE_SITE_PHRASES).size).toBe(REMOVE_SITE_PHRASES.length);
    for (const p of REMOVE_SITE_PHRASES) expect(p.split("{site}").length - 1).toBe(1);
  });

  test("are filled in with the domain being removed", () => {
    expect(phrasesFor(remove)).toContain("I want youtube.com to open without asking");
    expect(phrasesFor({ type: "pauseProtection", minutes: 15 })).toBe(COMMIT_PHRASES);
  });

  test("only the matching site's sentence confirms a removal", () => {
    expect(isCommitPhrase("i want YOUTUBE.COM to open without asking", remove)).toBe(true);
    expect(isCommitPhrase("I want reddit.com to open without asking", remove)).toBe(false);
    expect(isCommitPhrase(COMMIT_PHRASES[0], remove)).toBe(false);
    expect(isCommitPhrase("I want youtube.com to open without asking", { type: "endFocus" })).toBe(false);
  });
});

test("commit sentences are distinct from headings", () => {
  for (const p of COMMIT_PHRASES) expect(IMPULSE_PHRASES).not.toContain(p);
});
