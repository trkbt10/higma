/**
 * @file Lock down the two React export shapes emitted by
 * `renderComponentDeclaration`.
 *
 * The function is the single boundary where the `exportStyle` user
 * option becomes generated source. Testing its two branches directly —
 * rather than going through `emitFromFrames` end-to-end — keeps the
 * unit small and the failure messages legible when the contract drifts.
 */
import { renderComponentDeclaration } from "./files";

describe("renderComponentDeclaration", () => {
  const bodyLines: readonly string[] = [
    "  return (",
    "    <div />",
    "  );",
  ];

  it("emits a named function and a trailing default export for function-default", () => {
    const out = renderComponentDeclaration(
      "MyComponent",
      "_props: MyComponentProps = {}",
      bodyLines,
      "function-default",
    );
    expect(out).toEqual([
      "export function MyComponent(_props: MyComponentProps = {}): React.ReactElement {",
      "  return (",
      "    <div />",
      "  );",
      "}",
      "",
      "export default MyComponent;",
    ]);
  });

  it("emits a const arrow with no default export for const-named", () => {
    const out = renderComponentDeclaration(
      "MyComponent",
      "_props: MyComponentProps = {}",
      bodyLines,
      "const-named",
    );
    expect(out).toEqual([
      "export const MyComponent = (_props: MyComponentProps = {}): React.ReactElement => {",
      "  return (",
      "    <div />",
      "  );",
      "};",
    ]);
    // No `export default` line — the named-only contract is the
    // explicit point of this mode.
    expect(out.some((line) => line.includes("export default"))).toBe(false);
  });

  it("passes a switch-body through unchanged for variant components", () => {
    const switchBody: readonly string[] = [
      `  switch (variant) {`,
      `    case "On":`,
      `      return (<div />);`,
      `  }`,
    ];
    const constForm = renderComponentDeclaration(
      "Switcher",
      `{ variant = "On" }: SwitcherProps = {}`,
      switchBody,
      "const-named",
    );
    expect(constForm[0]).toBe(
      `export const Switcher = ({ variant = "On" }: SwitcherProps = {}): React.ReactElement => {`,
    );
    expect(constForm[constForm.length - 1]).toBe(`};`);

    const fnForm = renderComponentDeclaration(
      "Switcher",
      `{ variant = "On" }: SwitcherProps = {}`,
      switchBody,
      "function-default",
    );
    expect(fnForm[0]).toBe(
      `export function Switcher({ variant = "On" }: SwitcherProps = {}): React.ReactElement {`,
    );
    expect(fnForm[fnForm.length - 1]).toBe(`export default Switcher;`);
  });
});
