/**
 * @file Public entry for the Godot scene-tree IR.
 */
export type {
  GodotExtResource,
  GodotNode,
  GodotProperty,
  GodotResource,
  GodotScene,
  GodotSubResource,
  GodotValue,
} from "./types";
export {
  boolVal,
  colorVal,
  enumVal,
  extResource,
  extResourceRef,
  floatVal,
  intVal,
  node,
  nodePath,
  property,
  rect2,
  resource,
  scene,
  stringVal,
  subResource,
  subResourceRef,
  vector2,
  withChildren,
  withProperties,
  withProperty,
} from "./builder";
export { godotStringLiteral, printFloat, serializeResource, serializeScene } from "./serialize";
export { parseScene, ParseError } from "./parse";
