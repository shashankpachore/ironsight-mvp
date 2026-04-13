import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppNav } from "../components/app-nav";

describe("app nav", () => {
  it("shows Today tab for all roles", () => {
    const html = renderToStaticMarkup(<AppNav role="REP" />);
    expect(html).toContain('href="/today"');
  });

  it("shows admin links only for manager/admin", () => {
    const repHtml = renderToStaticMarkup(<AppNav role="REP" />);
    const managerHtml = renderToStaticMarkup(<AppNav role="MANAGER" />);
    expect(repHtml).not.toContain('href="/users"');
    expect(managerHtml).toContain('href="/users"');
  });
});
