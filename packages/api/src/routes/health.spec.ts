/**
 * @file Health route unit test.
 */
import { app } from "../app.ts";

describe("GET /api/health", () => {
  it("returns ok status", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: "ok" });
  });
});
