/**
 * @file Ambient declaration for CSS Module imports.
 *
 * Makes `import styles from "./Foo.module.css"` typecheck across every
 * package. CSS Modules return a class-name map (`{ [name]: hashedName }`).
 *
 * Note: only `*.module.css` is declared here. Plain `*.css` is NOT
 * declared on purpose — a side-effect-only CSS import (`import "./foo.css"`)
 * should fail to typecheck so the codebase never re-adopts that
 * pattern. The only acceptable runtime stylesheet attachment is via a
 * value-returning CSS Module import.
 */

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
