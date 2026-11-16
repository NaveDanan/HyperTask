// Adapted from OpenBot app/tests/browser-address.test.ts. Copyright (c) 2026 CopilotKit. MIT.
import { expect, test } from "vitest";
import { hyperAddressFrom } from "./HyperBrowserAddress";

/**
 * What the Browser page's address bar sends for what a person types, read the way Chrome's address bar reads it.
 */

test("an address with its scheme goes as typed", () => {
  for (const typed of [
    "https://github.com/CopilotKit/openbot/pulls?q=is%3Aopen",
    "http://127.0.0.1:3010/browser",
    "about:blank",
    "  https://example.com/  ",
  ])
    expect(hyperAddressFrom(typed)).toBe(typed.trim());
});

test("a bare host, with or without a port and a path, goes as https", () => {
  expect(hyperAddressFrom("openbot.ai")).toBe("https://openbot.ai");
  expect(hyperAddressFrom("news.ycombinator.com/item?id=1")).toBe(
    "https://news.ycombinator.com/item?id=1",
  );
  expect(hyperAddressFrom("localhost:3000")).toBe("https://localhost:3000");
  expect(hyperAddressFrom("127.0.0.1:8080/health")).toBe(
    "https://127.0.0.1:8080/health",
  );
  expect(hyperAddressFrom("[::1]:7740")).toBe("https://[::1]:7740");
});

test("anything else is a search", () => {
  expect(hyperAddressFrom("how to file an expense report")).toBe(
    "https://www.google.com/search?q=how%20to%20file%20an%20expense%20report",
  );
  expect(hyperAddressFrom("expenses")).toBe(
    "https://www.google.com/search?q=expenses",
  );
  expect(hyperAddressFrom("what is 2.5% of 80")).toBe(
    "https://www.google.com/search?q=what%20is%202.5%25%20of%2080",
  );
});

test("nothing typed goes nowhere", () => {
  expect(hyperAddressFrom("   ")).toBeNull();
});
