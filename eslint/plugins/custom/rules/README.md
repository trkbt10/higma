# eslint/plugins/custom/rules

Custom ESLint rules for the project.

## no-empty-jsdoc

Disallows empty JSDoc block comments that contain only whitespace.

```javascript
// Bad - empty JSDoc
/**
 *
 */
function foo() {}

// Good - meaningful JSDoc
/**
 * Does something useful.
 */
function foo() {}

// Good - no JSDoc
function foo() {}
```

This rule is auto-fixable: empty JSDoc blocks are removed entirely.

### Implementation

#### isEmptyJsdocContent

Internal helper that checks if a JSDoc comment's content is empty (only whitespace and `*` markers).

```javascript
function isEmptyJsdocContent(rawValue) {
  // Strips leading '*' and whitespace from each line,
  // returns true if concatenated content is empty
}
```

### Configuration

```javascript
// eslint.config.js
import noEmptyJsdoc from "./eslint/plugins/custom/rules/no-empty-jsdoc.js";

export default [
  {
    rules: {
      "custom/no-empty-jsdoc": "error",
    },
    plugins: {
      custom: {
        rules: {
          "no-empty-jsdoc": noEmptyJsdoc,
        },
      },
    },
  },
];
```
