/**
 * @file Product-free editor session contracts.
 */

export type EditorSessionKind = "fig" | "deck" | "buzz" | "site";

export type EditorSession<
  Document,
  Kind extends EditorSessionKind = EditorSessionKind,
  Insights = unknown,
> = {
  readonly kind: Kind;
  readonly document: Document;
  readonly insights: Insights;
};

/** Create a product-tagged editor session without importing product editor code. */
export function createEditorSession<Document, Kind extends EditorSessionKind>(
  kind: Kind,
  document: Document,
): EditorSession<Document, Kind, unknown>;
export function createEditorSession<Document, Kind extends EditorSessionKind, Insights>(
  kind: Kind,
  document: Document,
  insights: Insights,
): EditorSession<Document, Kind, Insights>;
export function createEditorSession<Document, Kind extends EditorSessionKind, Insights>(
  kind: Kind,
  document: Document,
  insights?: Insights,
): EditorSession<Document, Kind, Insights | unknown> {
  return {
    kind,
    document,
    insights,
  };
}
