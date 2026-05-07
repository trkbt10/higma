/**
 * @file Site role presentation tests.
 */

import { getSiteRolePresentation } from "./site-role-presentation";

describe("getSiteRolePresentation", () => {
  it("returns explicit labels for every site render role consumed by the editor UI", () => {
    expect(getSiteRolePresentation("cms-rich-text").label).toBe("CMS Rich Text");
    expect(getSiteRolePresentation("repeater").label).toBe("Repeater");
    expect(getSiteRolePresentation("responsive-set").label).toBe("Responsive Set");
    expect(getSiteRolePresentation("symbol").label).toBe("Symbol");
    expect(getSiteRolePresentation("instance").label).toBe("Instance");
  });
});
