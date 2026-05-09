/**
 * @file Suggest semantic names for nodes that currently use placeholder
 * names like "Frame", "Frame 12", "Group", "Rectangle".
 *
 * Naming rules — *signifier-first*:
 *
 *   - Slugs come from `@higma-primitives/identifier#toCssSlug`. We do
 *     not roll our own splitting logic here: the same SoT drives token
 *     extraction, JSX emit, and any future renamer.
 *
 *   - We never suggest a name that lacks a content signifier. A
 *     placeholder "Frame 12" is preferable to a meaningless "row" /
 *     "row-2" / "icon" — those merely shift the namelessness around.
 *     Concretely:
 *
 *       * TEXT  — slug(node.characters) when non-empty.
 *       * FRAME / GROUP — only when at least one of these
 *           discriminators exists:
 *             a) dominant TEXT slug inside the subtree, or
 *             b) the node's first child is an INSTANCE whose target
 *                SYMBOL has a meaningful name we can borrow, or
 *             c) the node holds exactly one icon-shaped subtree we
 *                can name after.
 *           When none apply we leave the placeholder in place.
 *       * Shape primitives (ELLIPSE / RECTANGLE / VECTOR) — only when
 *           the role hint is unambiguous *and* a sibling text /
 *           instance exists to disambiguate. A bare "avatar" without
 *           any neighbouring TEXT in the parent row would be just
 *           another empty noun.
 *
 *   - No numeric collision suffix. If two siblings would receive the
 *     same suggested name, both proposals are dropped — overwriting a
 *     placeholder with "row-2" misleads more than it helps.
 *
 * The visited tree is the *resolved* tree from the refine source so
 * INSTANCE swaps point at the right SYMBOL definition for label
 * borrowing.
 */
import type { FigNode } from "@higma-document-models/fig/types";
import { getNodeType, guidToString, safeChildren } from "@higma-document-models/fig/domain";
import { toCssSlug } from "@higma-primitives/identifier";
import { roleHintFor } from "./subtree-signature";

const PLACEHOLDER_PATTERNS = [
  /^frame(\s\d+)?$/i,
  /^group(\s\d+)?$/i,
  /^rectangle(\s\d+)?$/i,
  /^rounded\s+rectangle(\s\d+)?$/i,
  /^ellipse(\s\d+)?$/i,
  /^vector(\s\d+)?$/i,
  /^line(\s\d+)?$/i,
  /^polygon(\s\d+)?$/i,
  /^star(\s\d+)?$/i,
  /^text(\s\d+)?$/i,
];

function isPlaceholder(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) {
    return true;
  }
  return PLACEHOLDER_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Authored names are anything that already carries human intent.
 * The opposite of `isPlaceholder` — used to decide whether a
 * descendant's name can be borrowed as a discriminator.
 */
function isAuthoredName(name: string | undefined): boolean {
  if (!name) {
    return false;
  }
  return !isPlaceholder(name);
}

function clampSlug(s: string): string {
  // toCssSlug already lower-kebab-cases. We only cap the word count
  // so a 10-word headline doesn't become a 10-segment node name.
  if (!s) {
    return "";
  }
  const parts = s.split("-").filter((p) => p.length > 0);
  if (parts.length === 0) {
    return "";
  }
  if (parts.length <= 4) {
    return parts.join("-");
  }
  return parts.slice(0, 4).join("-");
}

/**
 * Refuse to treat a slug as a real discriminator when it looks like
 * placeholder content. Common offenders we have observed:
 *
 *   - "component", "component-3", "frame-12" — Figma's autogen names
 *     that designers leave untranslated inside the artwork itself.
 *   - "lorem", "ipsum", "dolor" — placeholder body copy.
 *   - single-character strings ("x", "1") — not enough information to
 *     identify anything.
 *
 * If the slug fails this filter, the caller should drop the rename
 * proposal entirely. A placeholder that looks like a name will outlive
 * the refactor and pollute the document forever; refusing to suggest
 * is the conservative path.
 */
function looksLikePlaceholderSlug(slug: string): boolean {
  if (!slug) {
    return true;
  }
  const head = slug.split("-")[0] ?? "";
  if (head.length <= 1) {
    return true;
  }
  // Only-numeric tail ("component-3" → "component", "3"), where the
  // head is itself a generic placeholder-y noun.
  const PLACEHOLDER_HEADS = new Set([
    "frame", "group", "rectangle", "rounded", "ellipse",
    "vector", "line", "polygon", "star", "text", "component", "instance",
    "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "placeholder",
  ]);
  if (PLACEHOLDER_HEADS.has(head)) {
    return true;
  }
  // Whole slug is placeholder-y when every segment is either a
  // placeholder noun or a number.
  const segments = slug.split("-");
  const allPlaceholder = segments.every((seg) => PLACEHOLDER_HEADS.has(seg) || /^\d+$/.test(seg));
  if (allPlaceholder) {
    return true;
  }
  return false;
}

function dominantTextSlug(node: FigNode, maxDepth = 4): string | undefined {
  const out: { depth: number; text: string }[] = [];
  walkText(node, 0, maxDepth, out);
  if (out.length === 0) {
    return undefined;
  }
  out.sort((a, b) => {
    if (a.depth !== b.depth) {
      return a.depth - b.depth;
    }
    return b.text.length - a.text.length;
  });
  // Walk text candidates in order until we find one whose slug is
  // not itself a placeholder. "Component 3" / "x" do not count.
  for (const candidate of out) {
    const slug = clampSlug(toCssSlug(candidate.text));
    if (slug.length > 0 && !looksLikePlaceholderSlug(slug)) {
      return slug;
    }
  }
  return undefined;
}

function walkText(node: FigNode, depth: number, maxDepth: number, out: { depth: number; text: string }[]): void {
  if (depth > maxDepth) {
    return;
  }
  if (getNodeType(node) === "TEXT") {
    const chars = node.characters ?? "";
    const trimmed = chars.trim();
    if (trimmed.length > 0) {
      out.push({ depth, text: trimmed });
    }
    return;
  }
  for (const child of safeChildren(node)) {
    walkText(child, depth + 1, maxDepth, out);
  }
}

/** Borrow the name of a single INSTANCE sole-child or single embedded icon. */
function borrowedDescendantName(node: FigNode): string | undefined {
  const kids = safeChildren(node);
  if (kids.length === 0) {
    return undefined;
  }
  const named = kids
    .map((c) => ({ type: getNodeType(c), name: c.name ?? "" }))
    .filter((entry) => isAuthoredName(entry.name));
  if (named.length !== 1) {
    return undefined;
  }
  const sole = named[0];
  if (!sole) {
    return undefined;
  }
  if (sole.type !== "INSTANCE" && sole.type !== "SYMBOL" && sole.type !== "COMPONENT") {
    // We only borrow from INSTANCE-like children — borrowing a TEXT
    // node's name on top of slugging its content double-counts the
    // signifier. The dominant-text path handles TEXT children.
    return undefined;
  }
  const slug = clampSlug(toCssSlug(sole.name));
  if (!slug || looksLikePlaceholderSlug(slug)) {
    return undefined;
  }
  return slug;
}

export type RenameProposal = {
  readonly nodeGuid: string;
  readonly currentName: string;
  readonly suggestedName: string;
  readonly reason: string;
};

function suggestForText(node: FigNode): { readonly name: string; readonly reason: string } | undefined {
  const chars = (node.characters ?? "").trim();
  if (!chars) {
    return undefined;
  }
  const slug = clampSlug(toCssSlug(chars));
  if (!slug || looksLikePlaceholderSlug(slug)) {
    return undefined;
  }
  return { name: slug, reason: "text content" };
}

function suggestForContainer(node: FigNode): { readonly name: string; readonly reason: string } | undefined {
  const hint = roleHintFor(node);
  const textSlug = dominantTextSlug(node);
  const borrowed = borrowedDescendantName(node);

  // Strict signifier rule: bail out if there's nothing distinguishing
  // *this* container from any other container with the same hint.
  if (!textSlug && !borrowed) {
    return undefined;
  }

  // Prefer the more specific signal in this order: borrowed instance
  // name (already carries human intent) > dominant text > skipped.
  const discriminator = borrowed ?? textSlug;
  if (!discriminator) {
    return undefined;
  }

  if (hint === "icon") {
    return { name: `${discriminator}-icon`, reason: "icon-shaped subtree with discriminator" };
  }
  if (hint === "button-bg") {
    return { name: `${discriminator}-button`, reason: "button-bg shaped with text" };
  }
  if (hint === "thumbnail") {
    return { name: `${discriminator}-media`, reason: "media surface with text" };
  }
  if (hint === "row") {
    return { name: `${discriminator}-row`, reason: "row container with text" };
  }
  if (hint === "card") {
    return { name: `${discriminator}-card`, reason: "card container with text" };
  }
  if (hint === "avatar") {
    return { name: `${discriminator}-avatar`, reason: "avatar container with neighbour text" };
  }
  if (hint === "container" || hint === "decoration") {
    return { name: discriminator, reason: "container with dominant text" };
  }
  // text-line / text-block / raw — the discriminator IS the slug,
  // adding "-group" creates noise. Skip.
  return undefined;
}

/**
 * Decide whether a shape primitive (ELLIPSE / RECTANGLE / VECTOR / …)
 * should be renamed. We require both a clear shape role *and* a
 * sibling-level discriminator — otherwise "avatar" alone is just
 * another placeholder.
 */
function suggestForShape(
  node: FigNode,
  parent: FigNode | undefined,
): { readonly name: string; readonly reason: string } | undefined {
  const hint = roleHintFor(node);
  if (hint !== "avatar" && hint !== "icon" && hint !== "button-bg") {
    return undefined;
  }
  if (!parent) {
    return undefined;
  }
  // Sibling discriminator: a TEXT or authored-name sibling.
  const siblings = safeChildren(parent).filter((s) => s !== node);
  const textSibling = siblings.find((s) => getNodeType(s) === "TEXT");
  if (textSibling) {
    const chars = textSibling.characters ?? "";
    const slug = clampSlug(toCssSlug(chars));
    if (slug.length > 0 && !looksLikePlaceholderSlug(slug)) {
      return { name: `${slug}-${hint === "button-bg" ? "button" : hint}`, reason: "shape with adjacent text" };
    }
  }
  // No sibling text — refuse to suggest a bare "avatar". Keep
  // placeholder.
  return undefined;
}

/** Walk frames and produce rename proposals for placeholder-named nodes. */
export function proposeRenames(frames: readonly FigNode[]): readonly RenameProposal[] {
  const collected: RenameProposal[] = [];
  for (const frame of frames) {
    visit(frame, undefined, collected);
  }
  return dropAmbiguousSiblingCollisions(collected, frames);
}

function visit(node: FigNode, parent: FigNode | undefined, out: RenameProposal[]): void {
  const t = getNodeType(node);
  const current = node.name ?? "";
  if (isPlaceholder(current)) {
    if (t === "TEXT") {
      const proposal = suggestForText(node);
      if (proposal && proposal.name !== current) {
        out.push({
          nodeGuid: guidToString(node.guid),
          currentName: current,
          suggestedName: proposal.name,
          reason: proposal.reason,
        });
      }
    } else if (t === "FRAME" || t === "GROUP") {
      const proposal = suggestForContainer(node);
      if (proposal && proposal.name !== current) {
        out.push({
          nodeGuid: guidToString(node.guid),
          currentName: current,
          suggestedName: proposal.name,
          reason: proposal.reason,
        });
      }
    } else {
      const proposal = suggestForShape(node, parent);
      if (proposal && proposal.name !== current) {
        out.push({
          nodeGuid: guidToString(node.guid),
          currentName: current,
          suggestedName: proposal.name,
          reason: proposal.reason,
        });
      }
    }
  }
  for (const child of safeChildren(node)) {
    visit(child, node, out);
  }
}

/**
 * Drop proposals whose suggested name would collide with another
 * sibling's suggested or existing name. We refuse to disambiguate
 * with a numeric suffix — leaving the placeholder is more honest
 * than promoting two distinct nodes to a name they are not
 * individually responsible for.
 */
function dropAmbiguousSiblingCollisions(
  proposals: readonly RenameProposal[],
  frames: readonly FigNode[],
): readonly RenameProposal[] {
  const byGuid = new Map<string, RenameProposal>();
  for (const p of proposals) {
    byGuid.set(p.nodeGuid, p);
  }
  const drops = new Set<string>();
  for (const frame of frames) {
    walkSiblingGroups(frame, byGuid, drops);
  }
  return proposals.filter((p) => !drops.has(p.nodeGuid));
}

function walkSiblingGroups(
  node: FigNode,
  byGuid: ReadonlyMap<string, RenameProposal>,
  drops: Set<string>,
): void {
  const children = safeChildren(node);
  if (children.length > 0) {
    flagCollisionsAmongSiblings(children, byGuid, drops);
    for (const c of children) {
      walkSiblingGroups(c, byGuid, drops);
    }
  }
}

function flagCollisionsAmongSiblings(
  siblings: readonly FigNode[],
  byGuid: ReadonlyMap<string, RenameProposal>,
  drops: Set<string>,
): void {
  const usedNames = new Map<string, string[]>();
  for (const child of siblings) {
    const guid = guidToString(child.guid);
    const proposal = byGuid.get(guid);
    const finalName = proposal ? proposal.suggestedName : child.name?.trim() ?? "";
    if (!finalName) {
      continue;
    }
    const lower = finalName.toLowerCase();
    const arr = usedNames.get(lower) ?? [];
    arr.push(guid);
    usedNames.set(lower, arr);
  }
  for (const guids of usedNames.values()) {
    if (guids.length <= 1) {
      continue;
    }
    // Drop only the proposal-driven entries; we cannot mutate
    // pre-existing authored names, only refrain from competing
    // with them.
    for (const guid of guids) {
      if (byGuid.has(guid)) {
        drops.add(guid);
      }
    }
  }
}
