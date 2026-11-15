const { waitSeconds, isCommitPhrase, normalizePhrase } = require("../src/shared/friction");
const { COMMIT_PHRASES } = require("../src/shared/defaults");

describe("waitSeconds", () => {
  const cfg = { baseWait: 10, maxWait: 120 };

  test("doubles with each unlock today and caps at maxWait", () => {
    expect([0, 1, 2, 3, 4, 5, 50].map((n) => waitSeconds(n, cfg))).toEqual([10, 20, 40, 80, 120, 120, 120]);
  });

  test("handles odd inputs", () => {
    expect(waitSeconds(undefined, cfg)).toBe(10);
    expect(waitSeconds(-3, cfg)).toBe(10);
    expect(waitSeconds(2, { baseWait: 0, maxWait: 120 })).toBe(0);
  });
});

describe("commit phrase", () => {
  test("accepts any listed phrase ignoring case, punctuation and spacing", () => {
    const p = COMMIT_PHRASES[0];
    expect(isCommitPhrase(p)).toBe(true);
    expect(isCommitPhrase("  " + p.toUpperCase().replace(/ /g, "   ") + ".  ")).toBe(true);
  });

  test("rejects partial or wrong text", () => {
    expect(isCommitPhrase("")).toBe(false);
    expect(isCommitPhrase(COMMIT_PHRASES[0].slice(0, -3))).toBe(false);
    expect(isCommitPhrase("let me in")).toBe(false);
  });

  test("normalizePhrase", () => {
    expect(normalizePhrase("  Hello,   World! ")).toBe("hello world");
  });
});
