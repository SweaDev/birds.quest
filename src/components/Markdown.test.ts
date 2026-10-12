import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { Markdown } from "./Markdown";

const render = (md: string) => renderToStaticMarkup(createElement(Markdown, null, md));

describe("Markdown sanitisation", () => {
  it("renders normal Markdown", () => {
    const html = render("## Great Tit\n\n*Parus major*\n\n![Great Tit](https://upload.wikimedia.org/a.jpg)");
    expect(html).toContain("<h2");
    expect(html).toContain("<em>Parus major</em>");
    expect(html).toContain('src="https://upload.wikimedia.org/a.jpg"');
  });

  it("drops scripts, raw html and event handlers", () => {
    const html = render('<script>alert(1)</script><img src=x onerror="alert(1)"><b onclick="x()">b</b>');
    expect(html).not.toMatch(/<script|onerror|onclick/i);
  });

  it("neutralises javascript: links and images", () => {
    const html = render("[click](javascript:alert(1)) ![x](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("opens links safely", () => {
    expect(render("[w](https://en.wikipedia.org/wiki/Great_tit)")).toContain('rel="noopener noreferrer nofollow"');
  });
});
