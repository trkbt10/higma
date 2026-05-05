/**
 * @file Explicit fig builder state construction for editor mutations.
 */

import { createFigBuilderStateFromDocument } from "@higma-document-io/fig/types";
import type { FigBuilderState } from "@higma-document-io/fig/types";
import type { FigDesignDocument } from "@higma-document-models/fig/domain";

const FIG_EDITOR_NODE_SESSION_ID = 1;
const FIG_EDITOR_PAGE_SESSION_ID = 0;
const FIG_EDITOR_MINIMUM_NODE_LOCAL_ID = 1;
const FIG_EDITOR_MINIMUM_PAGE_LOCAL_ID = 1;

/**
 * Build explicit fig document IO state from the current editor document.
 */
export function createEditorFigBuilderState(document: FigDesignDocument): FigBuilderState {
  return createFigBuilderStateFromDocument({
    document,
    nodeSessionID: FIG_EDITOR_NODE_SESSION_ID,
    pageSessionID: FIG_EDITOR_PAGE_SESSION_ID,
    minimumNodeLocalID: FIG_EDITOR_MINIMUM_NODE_LOCAL_ID,
    minimumPageLocalID: FIG_EDITOR_MINIMUM_PAGE_LOCAL_ID,
  });
}
