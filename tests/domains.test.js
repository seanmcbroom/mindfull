const { normalizeDomain, hostOf, matchSite, toRegexFilter } = require("../src/shared/domains");

describe("normalizeDomain", () => {
  test.each([
    ["https://www.YouTube.com/shorts", "youtube.com"],
    ["reddit.com", "reddit.com"],
    ["  x.com  ", "x.com"],
    ["m.youtube.com", "m.youtube.com"],
    ["http://sub.example.co.uk:8080/path?q=1", "sub.example.co.uk"],
    ["www.instagram.com/", "instagram.com"],
    ["news.ycombinator.com.", "news.ycombinator.com"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  test.each(["", "   ", "localhost", "not a url", "http://", null, 42])("rejects %p", (input) => {
    expect(normalizeDomain(input)).toBeNull();
  });
});

describe("hostOf", () => {
  test("http(s) only", () => {
    expect(hostOf("https://M.YouTube.com/watch?v=1")).toBe("m.youtube.com");
    expect(hostOf("chrome://extensions")).toBeNull();
    expect(hostOf("about:blank")).toBeNull();
    expect(hostOf("garbage")).toBeNull();
  });
});

describe("matchSite", () => {
  const sites = [{ domain: "youtube.com" }, { domain: "music.youtube.com" }, { domain: "x.com" }];

  test("matches domain and subdomains, preferring the most specific", () => {
    expect(matchSite("youtube.com", sites)).toBe("youtube.com");
    expect(matchSite("www.youtube.com", sites)).toBe("youtube.com");
    expect(matchSite("music.youtube.com", sites)).toBe("music.youtube.com");
    expect(matchSite("a.music.youtube.com", sites)).toBe("music.youtube.com");
  });

  test("does not match lookalikes", () => {
    expect(matchSite("notyoutube.com", sites)).toBeNull();
    expect(matchSite("youtube.com.evil.net", sites)).toBeNull();
    expect(matchSite("box.com", sites)).toBeNull();
    expect(matchSite(null, sites)).toBeNull();
  });
});

describe("toRegexFilter", () => {
  const re = new RegExp(toRegexFilter("youtube.com"));

  test.each([
    "https://youtube.com",
    "https://youtube.com/",
    "https://www.youtube.com/watch?v=abc&t=10",
    "http://m.youtube.com:8080/",
    "https://youtube.com?x=1",
    "https://youtube.com#frag",
  ])("matches %s", (url) => expect(re.test(url)).toBe(true));

  test.each([
    "https://notyoutube.com/",
    "https://youtube.com.evil.net/",
    "https://evil.net/?u=https://youtube.com/",
    "ftp://youtube.com/",
    "https://youtubexcom/",
  ])("does not match %s", (url) => expect(re.test(url)).toBe(false));
});
