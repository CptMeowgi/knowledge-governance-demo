import { describe, expect, it } from "vitest";
import { article, kb, published } from "../test/fixtures";
import { searchArticles } from "./search";

const base = kb({
  articles: [
    published({ id: "reset", title: "Reset your password" }),
    published({
      id: "mfa",
      title: "Sign in with multi-factor authentication",
      body: { goal: "Set up your second factor.", before: "", steps: "1. Open the authenticator app.", result: "You can sign in." },
    }),
    article({ id: "vpn-draft", title: "Set up the VPN client" }),
    article({ id: "vpn-old", title: "Old VPN client", state: "retired" }),
  ],
});

describe("search", () => {
  it("uses the glossary, so avoided wording still finds the right content", () => {
    expect(searchArticles(base, "login")).toEqual(["mfa", "reset"]);
    expect(searchArticles(base, "2FA")).toEqual(["mfa"]);
  });

  it("ranks title matches above body matches", () => {
    expect(searchArticles(base, "sign in")[0]).toBe("mfa");
  });

  it("only returns published content", () => {
    expect(searchArticles(base, "vpn client")).toEqual([]);
  });

  it("needs at least half of the query's keywords to match", () => {
    expect(searchArticles(base, "password reset printer")).toEqual(["reset"]);
    expect(searchArticles(base, "printer toner jam password")).toEqual([]);
  });

  it("returns nothing for queries made only of filler words", () => {
    expect(searchArticles(base, "how do I")).toEqual([]);
  });
});
