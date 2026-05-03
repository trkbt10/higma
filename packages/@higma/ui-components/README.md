# @higma/ui-components

Shared React UI component library. Design tokens, icons, primitives, layout components, and specialized widgets.

## Design Tokens

CSS custom properties for consistent styling.

```typescript
import { tokens, injectCSSVariables, cssVar } from "@higma/ui-components";

// Inject CSS variables into document
injectCSSVariables();

// Use in styles
const style = {
  color: cssVar("color-text"),
  padding: cssVar("spacing-md"),
  borderRadius: cssVar("radius-sm"),
};

// Access token values directly
tokens.color.primary; // "#0066cc"
tokens.spacing.md;    // "12px"
```

## Icons

Lucide-based icon components.

```tsx
import {
  AddIcon,
  DeleteIcon,
  EditIcon,
  BoldIcon,
  ItalicIcon,
  AlignLeftIcon,
  // ... 100+ icons
} from "@higma/ui-components";

<AddIcon size={16} />
<DeleteIcon size={24} color="red" />
```

## Primitives

### Button

```tsx
import { Button, IconButton, ToolbarButton } from "@higma/ui-components";

<Button variant="primary" size="md" onClick={handleClick}>
  Save
</Button>

<IconButton icon={<DeleteIcon />} onClick={handleDelete} />

<ToolbarButton icon={<BoldIcon />} active={isBold} onClick={toggleBold} />
```

### Input / Select

```tsx
import { Input, Select, SearchableSelect, Slider } from "@higma/ui-components";

<Input value={text} onChange={setText} placeholder="Enter text..." />

<Select
  value={selected}
  onChange={setSelected}
  options={[
    { value: "a", label: "Option A" },
    { value: "b", label: "Option B" },
  ]}
/>

<SearchableSelect
  value={font}
  onChange={setFont}
  options={fontOptions}
  placeholder="Search fonts..."
/>

<Slider value={opacity} onChange={setOpacity} min={0} max={100} />
```

### Popover / Tabs / Toggle

```tsx
import { Popover, Tabs, Toggle, ToggleButton } from "@higma/ui-components";

<Popover trigger={<Button>Menu</Button>}>
  <MenuContent />
</Popover>

<Tabs
  items={[
    { id: "design", label: "Design", content: <DesignPanel /> },
    { id: "code", label: "Code", content: <CodePanel /> },
  ]}
  activeId={activeTab}
  onChange={setActiveTab}
/>

<Toggle checked={enabled} onChange={setEnabled} />
<ToggleButton active={isActive} onClick={toggle}>Option</ToggleButton>
```

## Layout

```tsx
import { Panel, Section, FieldGroup, FieldRow } from "@higma/ui-components";

<Panel title="Properties">
  <Section title="Position">
    <FieldGroup>
      <FieldRow label="X">
        <Input value={x} onChange={setX} />
      </FieldRow>
      <FieldRow label="Y">
        <Input value={y} onChange={setY} />
      </FieldRow>
    </FieldGroup>
  </Section>
</Panel>
```

## Context Menu

```tsx
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSubmenu,
} from "@higma/ui-components";

<ContextMenu
  position={{ x: mouseX, y: mouseY }}
  onClose={closeMenu}
>
  <ContextMenuItem onClick={handleCopy}>Copy</ContextMenuItem>
  <ContextMenuItem onClick={handlePaste}>Paste</ContextMenuItem>
  <ContextMenuSeparator />
  <ContextMenuSubmenu label="Align">
    <ContextMenuItem onClick={alignLeft}>Left</ContextMenuItem>
    <ContextMenuItem onClick={alignCenter}>Center</ContextMenuItem>
    <ContextMenuItem onClick={alignRight}>Right</ContextMenuItem>
  </ContextMenuSubmenu>
</ContextMenu>
```

## Grouped List

Hierarchical list with drag-drop, selection, and inline editing.

```tsx
import {
  GroupedList,
  GroupedListGroup,
  GroupedListItem,
  useGroupedListDragDrop,
} from "@higma/ui-components";

<GroupedList
  groups={groups}
  items={items}
  selection={selection}
  onSelectionChange={setSelection}
  onReorder={handleReorder}
>
  {groups.map(group => (
    <GroupedListGroup key={group.id} group={group}>
      {group.items.map(item => (
        <GroupedListItem key={item.id} item={item} />
      ))}
    </GroupedListGroup>
  ))}
</GroupedList>
```

## Virtual Scroll

Virtualized list for large datasets.

```tsx
import { VirtualScroll, useVirtualScroll } from "@higma/ui-components";

<VirtualScroll
  itemCount={10000}
  itemHeight={32}
  height={400}
  renderItem={({ index, style }) => (
    <div style={style}>{items[index].name}</div>
  )}
/>
```

## Player

Media player controls.

```tsx
import { Player, PlayerControls } from "@higma/ui-components";

<Player
  media={mediaSource}
  state={playerState}
  onStateChange={setPlayerState}
>
  <PlayerControls variant="compact" />
</Player>
```
