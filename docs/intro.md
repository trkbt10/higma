A TypeScript toolkit for programmatically reading, writing, rendering, and editing Figma `.fig` files.

higma provides a full-stack implementation of the Figma file format (fig-kiwi). From parsing and building to SVG rendering and a React-based visual editor, it covers everything needed to work with `.fig` files programmatically.

```
.fig file
    ↓ parse
NodeChanges + Blobs (Figma document structure)
    ↓ render
SVG string
    ↓ edit
FigEditor (React component)
    ↓ export
.fig file
```
