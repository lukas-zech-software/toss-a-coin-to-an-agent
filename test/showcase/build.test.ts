import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assemblePage,
  externalResources,
  MAX_BYTES,
  renderPage,
} from "../../src/showcase/build.ts";
import type { ShowcaseData } from "../../src/showcase/types.ts";

const TEMPLATE = `<!doctype html><html><head><title>Münzen</title></head><body><main></main><!--SHOWCASE_DATA--><script>main()</script></body></html>`;

const data = (title: string): ShowcaseData =>
  ({
    builtAt: "2026-11-13T12:00:00+01:00",
    capture: { id: "COIN-0019", title },
    coins: [],
  }) as unknown as ShowcaseData;

const scriptContent = (html: string): string => {
  const m =
    /<script type="application\/json" id="showcase-data">([\s\S]*?)<\/script>/.exec(
      html,
    );
  assert.ok(m, "data script present");
  return m[1]!;
};

test("renderPage escapes </script> in data", () => {
  const html = renderPage(TEMPLATE, data("</script><b>x</b>"));
  const json = scriptContent(html);
  assert.ok(!json.includes("</script>"));
  assert.ok(!json.includes("<"));
  assert.equal(JSON.parse(json).capture.title, "</script><b>x</b>");
  assert.ok(html.endsWith("<script>main()</script></body></html>"));
});

test("renderPage needs exactly one marker", () => {
  assert.throws(() => renderPage("<html></html>", data("x")), /SHOWCASE_DATA/);
  assert.throws(
    () => renderPage(`${TEMPLATE}<!--SHOWCASE_DATA-->`, data("x")),
    /SHOWCASE_DATA/,
  );
});

test("externalResources finds src/link/url() but not <a href>", () => {
  const html = `
    <a href="https://www.numista.com/x">Numista</a>
    <img src="https://example.com/a.jpg">
    <link rel="stylesheet" href="https://fonts.example.com/f.css">
    <script src="//cdn.example.com/x.js"></script>
    <div style="background:url('https://example.com/bg.png')"></div>
    <style>@import "https://example.com/i.css";</style>
    <img src="data:image/jpeg;base64,AA">`;
  assert.deepEqual(externalResources(html), [
    "https://example.com/a.jpg",
    "https://fonts.example.com/f.css",
    "//cdn.example.com/x.js",
    "https://example.com/bg.png",
    "https://example.com/i.css",
  ]);
});

test("assemblePage rejects a page over MAX_BYTES", () => {
  const big = data("x".repeat(MAX_BYTES + 10));
  assert.throws(() => assemblePage(TEMPLATE, big), /MB/);
});

test("assemblePage rejects external resources", () => {
  assert.throws(
    () =>
      assemblePage(
        TEMPLATE.replace(
          "<main>",
          `<main><img src="https://example.com/a.jpg">`,
        ),
        data("x"),
      ),
    /https:\/\/example\.com\/a\.jpg/,
  );
});

test("assemblePage returns the page and its size", () => {
  const { html, bytes } = assemblePage(TEMPLATE, data("Vereinstaler"));
  assert.equal(bytes, Buffer.byteLength(html));
  assert.match(html, /Vereinstaler/);
});
