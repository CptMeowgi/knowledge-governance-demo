import { describe, expect, it } from "vitest";
import { kb } from "../test/fixtures";
import { canonicalize, findGlossaryViolations } from "./glossary";

const { glossary } = kb();

describe("glossary checks", () => {
  it("finds avoided terms regardless of case and reports them as written", () => {
    expect(findGlossaryViolations("Use 2FA to Login.", glossary)).toEqual([
      { termId: "sign-in", found: "Login", preferred: "sign in" },
      { termId: "mfa", found: "2FA", preferred: "multi-factor authentication" },
    ]);
  });

  it("treats spaces and hyphens in a phrase as the same thing", () => {
    expect(findGlossaryViolations("Log-on with your badge.", glossary).map((v) => v.found)).toEqual(["Log-on"]);
  });

  it("matches whole words only", () => {
    expect(findGlossaryViolations("Open LoginSight and the catalog.", glossary)).toEqual([]);
  });

  it("reports each spelling once, however often it's used", () => {
    expect(findGlossaryViolations("login, Login, LOGIN, log in", glossary).map((v) => v.found)).toEqual(["log in", "login"]);
  });

  it("passes text that uses the agreed terms", () => {
    expect(findGlossaryViolations("Sign in with multi-factor authentication.", glossary)).toEqual([]);
  });
});

describe("canonicalizing text for search", () => {
  it("maps avoided terms to the agreed term and strips punctuation", () => {
    expect(canonicalize("Can't Log-on? Log on with 2FA!", glossary)).toBe(
      "can t sign in sign in with multi factor authentication",
    );
  });

  it("treats different wordings of the same request as identical", () => {
    expect(canonicalize("login problem", glossary)).toBe(canonicalize("Sign-in problem", glossary));
  });
});
