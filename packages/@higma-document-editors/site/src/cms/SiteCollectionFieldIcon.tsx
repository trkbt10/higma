/**
 * @file Map a CMS field kind to its icon component.
 */

import {
  CalendarIcon,
  FileIcon,
  ImageIcon,
  ListViewIcon,
  ShareIcon,
  TextBoxIcon,
  ToggleIcon,
  type IconComponent,
} from "@higma-editor-kernel/ui/icons";

import type { SiteCollectionFieldKind } from "../domain/site-collection-field-kind";

const KIND_TO_ICON: Readonly<Record<SiteCollectionFieldKind, IconComponent>> = {
  text: TextBoxIcon,
  "rich-text": ListViewIcon,
  image: ImageIcon,
  date: CalendarIcon,
  link: ShareIcon,
  number: FileIcon,
  boolean: ToggleIcon,
};

export type SiteCollectionFieldIconProps = {
  readonly kind: SiteCollectionFieldKind;
  readonly size?: number;
};

/** Render the icon associated with a CMS field kind. */
export function SiteCollectionFieldIcon({ kind, size = 14 }: SiteCollectionFieldIconProps) {
  const Icon = KIND_TO_ICON[kind];
  return <Icon size={size} strokeWidth={1.5} />;
}
