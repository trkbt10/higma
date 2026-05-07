/**
 * @file Site document editor public API.
 */

export {
  createSiteEditableUnit,
  createSiteEditorSession,
  createSiteEditorWorkspace,
  exportEditedSiteDocument,
  openSiteEditor,
  type SiteEditableUnit,
  type SiteEditorOverview,
  type SiteEditorSession,
  type SiteEditorWorkspace,
} from "./site-editor-workspace";
export { SiteEditor, type SiteEditorProps } from "./editor/SiteEditor";
export {
  SiteEditorProvider,
  useSiteEditor,
  type SiteEditorContextValue,
  type SiteEditorEditState,
} from "./context/SiteEditorContext";
export {
  extractSiteCollections,
  findSiteCollection,
  findSiteCollectionField,
  findSiteCollectionItem,
  findSiteCollectionItemValue,
  type SiteCollection,
  type SiteCollectionField,
  type SiteCollectionFieldReference,
  type SiteCollectionFilter,
  type SiteCollectionItem,
  type SiteCollectionItemValue,
  type SiteCollectionSelector,
} from "./domain/site-collections";
export {
  classifySiteCollectionFieldKind,
  classifySiteCollectionFieldKindFromAll,
  getSiteCollectionFieldKindLabel,
  type SiteCollectionFieldKind,
} from "./domain/site-collection-field-kind";
export {
  getSiteCollectionDisplayName,
  getSiteCollectionFieldDisplayName,
  getSiteCollectionItemDisplayName,
} from "./cms/SiteCmsPresentation";
export {
  SiteCmsProvider,
  useSiteCms,
  type SiteCmsContextValue,
} from "./cms/SiteCmsContext";
export {
  INITIAL_SITE_CMS_STATE,
  fieldEditKey,
  isSiteCmsDraftId,
  makeAutoCollectionDisplayName,
  makeAutoFieldDisplayName,
  makeNextDraftCollectionId,
  makeNextDraftFieldId,
  makeNextDraftItemId,
  resolveRelativeItemId,
  selectActiveSiteCmsCollection,
  selectActiveSiteCmsItem,
  selectCollectionDisplayName,
  selectFieldDisplayName,
  selectFieldEdits,
  selectSiteCmsCollections,
  siteCmsReducer,
  type SiteCmsAction,
  type SiteCmsDraftCollection,
  type SiteCmsDraftField,
  type SiteCmsDraftItem,
  type SiteCmsDrafts,
  type SiteCmsFieldEdit,
  type SiteCmsState,
} from "./cms/site-cms-state";
export { SiteCmsCollectionsPanel } from "./cms/SiteCmsCollectionsPanel";
export { SiteCmsCollectionView } from "./cms/SiteCmsCollectionView";
export { SiteCmsItemEditor } from "./cms/SiteCmsItemEditor";
export { SiteCmsWorkspace } from "./cms/SiteCmsWorkspace";
export { SiteCollectionFieldIcon, type SiteCollectionFieldIconProps } from "./cms/SiteCollectionFieldIcon";
