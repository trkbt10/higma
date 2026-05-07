/**
 * @file Semantic editor icon components.
 */

import { createElement, type ComponentProps, type ReactElement } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Baseline,
  Bold,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Check,
  Circle,
  Clipboard,
  Copy,
  Diamond,
  Download,
  Eye,
  EyeOff,
  File,
  FileBox,
  Folder,
  GalleryVertical,
  GitBranch,
  Group,
  Highlighter,
  Image,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Layers,
  LayersIcon,
  LayoutGrid,
  Link2,
  List,
  ListOrdered,
  Loader,
  Lock,
  Maximize2,
  Minimize2,
  Minus,
  MoreHorizontal,
  MousePointer2,
  MoveDown,
  MoveUp,
  Music,
  Palette,
  PanelLeft,
  Pause,
  PenTool,
  Pencil,
  Play,
  Plus,
  RectangleHorizontal,
  Redo2,
  Replace,
  ReplaceAll,
  RotateCcw,
  Scissors,
  Settings,
  Shapes,
  Share2,
  Shield,
  SkipBack,
  SkipForward,
  Sparkles,
  Square,
  SquarePen,
  Star,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TableCellsMerge,
  TableCellsSplit,
  TextWrap,
  Trash2,
  Triangle,
  Type,
  Undo2,
  Underline,
  Ungroup,
  Unlock,
  Upload,
  Video,
  X,
} from "lucide-react";

type IconProps = ComponentProps<typeof MousePointer2>;

/** Icon component type used by editor controls. */
export type IconComponent = (props: IconProps) => ReactElement;

function createIcon(Icon: typeof MousePointer2): IconComponent {
  return function EditorIcon(props: IconProps): ReactElement {
    return createElement(Icon, props);
  };
}

// Selection
export const SelectIcon = createIcon(MousePointer2);

// Basic shapes
export const FrameIcon = createIcon(Square);
export const RectIcon = createIcon(Square);
export const RoundRectIcon = createIcon(RectangleHorizontal);
export const EllipseIcon = createIcon(Circle);
export const TriangleIcon = createIcon(Triangle);
export const DiamondIcon = createIcon(Diamond);
export const StarIcon = createIcon(Star);

// Arrows
export const RightArrowIcon = createIcon(ArrowRight);
export const LeftArrowIcon = createIcon(ArrowLeft);
export const ArrowUpIcon = createIcon(ArrowUp);
export const ArrowDownIcon = createIcon(ArrowDown);

// Lines
export const LineIcon = createIcon(Minus);
export const ConnectorIcon = createIcon(Link2);

// Path drawing
export const PenIcon = createIcon(PenTool);
export const PencilIcon = createIcon(Pencil);

// Text
export const TextBoxIcon = createIcon(Type);

// Actions
export const UndoIcon = createIcon(Undo2);
export const RedoIcon = createIcon(Redo2);
export const TrashIcon = createIcon(Trash2);
export const DeleteIcon = createIcon(Trash2);
export const CopyIcon = createIcon(Copy);
export const PasteIcon = createIcon(Clipboard);
export const CutIcon = createIcon(Scissors);

// Layer ordering
export const BringToFrontIcon = createIcon(Layers);
export const SendToBackIcon = createIcon(LayersIcon);
export const BringForwardIcon = createIcon(MoveUp);
export const SendBackwardIcon = createIcon(MoveDown);

// Grouping
export const GroupIcon = createIcon(Group);
export const UngroupIcon = createIcon(Ungroup);
export const FolderIcon = createIcon(Folder);

// Objects
export const PictureIcon = createIcon(Image);
export const TableIcon = createIcon(Table);
export const MergeCellsIcon = createIcon(TableCellsMerge);
export const UnmergeCellsIcon = createIcon(TableCellsSplit);
export const ChartIcon = createIcon(BarChart3);
export const DiagramIcon = createIcon(GitBranch);
export const OleObjectIcon = createIcon(FileBox);
export const UnknownShapeIcon = createIcon(Shapes);

// Media types
export const ImageIcon = createIcon(Image);
export const AudioIcon = createIcon(Music);
export const VideoIcon = createIcon(Video);
export const FileIcon = createIcon(File);

// View modes
export const TileViewIcon = createIcon(LayoutGrid);
export const ListViewIcon = createIcon(List);

// UI elements
export const AddIcon = createIcon(Plus);
export const EnterFullscreenIcon = createIcon(Maximize2);
export const ExitFullscreenIcon = createIcon(Minimize2);
export const PlayIcon = createIcon(Play);
export const PauseIcon = createIcon(Pause);
export const StopIcon = createIcon(Square);
export const SkipForwardIcon = createIcon(SkipForward);
export const SkipBackIcon = createIcon(SkipBack);
export const RotateCcwIcon = createIcon(RotateCcw);
export const LoaderIcon = createIcon(Loader);
export const DownloadIcon = createIcon(Download);
export const UploadIcon = createIcon(Upload);
export const CloseIcon = createIcon(X);
export const ReplaceIcon = createIcon(Replace);
export const ReplaceAllIcon = createIcon(ReplaceAll);
export const ChevronRightIcon = createIcon(ChevronRight);
export const ChevronDownIcon = createIcon(ChevronDown);
export const ChevronUpIcon = createIcon(ChevronUp);
export const ChevronLeftIcon = createIcon(ChevronLeft);
export const ArrowRightIcon = createIcon(ArrowRight);
export const CheckIcon = createIcon(Check);
export const MoreIcon = createIcon(MoreHorizontal);
export const SettingsIcon = createIcon(Settings);
export const FxIcon = createIcon(Sparkles);
export const EditIcon = createIcon(SquarePen);
export const SidebarIcon = createIcon(PanelLeft);
export const GalleryVerticalIcon = createIcon(GalleryVertical);
export const GridIcon = createIcon(LayoutGrid);
export const ShieldIcon = createIcon(Shield);
export const ShareIcon = createIcon(Share2);
export const VisibleIcon = createIcon(Eye);
export const HiddenIcon = createIcon(EyeOff);
export const LockIcon = createIcon(Lock);
export const UnlockIcon = createIcon(Unlock);

// Text formatting
export const BoldIcon = createIcon(Bold);
export const ItalicIcon = createIcon(Italic);
export const UnderlineIcon = createIcon(Underline);
export const StrikethroughIcon = createIcon(Strikethrough);
export const SuperscriptIcon = createIcon(Superscript);
export const SubscriptIcon = createIcon(Subscript);

// Alignment
export const AlignLeftIcon = createIcon(AlignLeft);
export const AlignCenterIcon = createIcon(AlignCenter);
export const AlignRightIcon = createIcon(AlignRight);
export const AlignJustifyIcon = createIcon(AlignJustify);
export const AlignTopIcon = createIcon(AlignVerticalJustifyStart);
export const AlignMiddleIcon = createIcon(AlignVerticalJustifyCenter);
export const AlignBottomIcon = createIcon(AlignVerticalJustifyEnd);

// Lists & indentation
export const ListIcon = createIcon(List);
export const ListOrderedIcon = createIcon(ListOrdered);
export const IndentIncreaseIcon = createIcon(IndentIncrease);
export const IndentDecreaseIcon = createIcon(IndentDecrease);

// Text wrap
export const WrapTextIcon = createIcon(TextWrap);

// Font / color
export const TypeIcon = createIcon(Type);
export const BaselineIcon = createIcon(Baseline);
export const HighlighterIcon = createIcon(Highlighter);
export const PaletteIcon = createIcon(Palette);
