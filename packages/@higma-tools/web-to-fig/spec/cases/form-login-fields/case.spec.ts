/**
 * @file Case `form-login-fields` — login form with two labelled
 * inputs + a chrome-bearing submit button.
 *
 * Asserts:
 *   - The form keeps three children (two rows + submit).
 *   - Each row carries its label TEXT and an input FRAME.
 *   - The submit button promotes to FRAME-wrapping-TEXT.
 */
import { asFrame, normalizeOne, singleChild } from "../_helpers";
import { FIELDS, SUBMIT_LABEL, loginForm } from "./fixture";

describe("case form-login-fields", () => {
  const ir = normalizeOne(loginForm());
  const form = asFrame(singleChild(ir));

  it("preserves all rows + the submit button", () => {
    expect(form.children).toHaveLength(FIELDS.length + 1);
  });

  it("captures the label TEXT inside each row", () => {
    for (let i = 0; i < FIELDS.length; i += 1) {
      const row = form.children[i];
      if (!row || row.kind !== "frame") {
        throw new Error(`expected row ${i} to be a frame`);
      }
      const label = row.children[0];
      if (!label || label.kind !== "text") {
        throw new Error(`expected row ${i} label to be a text`);
      }
      expect(label.characters).toBe(FIELDS[i]!.label);
    }
  });

  it("preserves the input FRAME (replaced element) inside each row", () => {
    for (let i = 0; i < FIELDS.length; i += 1) {
      const row = form.children[i];
      if (!row || row.kind !== "frame") {
        throw new Error(`expected row ${i} to be a frame`);
      }
      const input = row.children[1];
      if (!input || input.kind !== "frame") {
        throw new Error(`expected row ${i} input to be a frame`);
      }
    }
  });

  it("promotes the chrome-bearing submit button to FRAME-wrapping-TEXT", () => {
    const submit = form.children[form.children.length - 1];
    if (!submit || submit.kind !== "frame") {
      throw new Error("expected submit chrome frame");
    }
    expect(submit.children).toHaveLength(1);
    const labelText = submit.children[0];
    if (!labelText || labelText.kind !== "text") {
      throw new Error("expected submit label text");
    }
    expect(labelText.characters).toBe(SUBMIT_LABEL);
  });
});
