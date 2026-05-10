@tool
extends SceneTree

# Batch headless render driver. Reads a manifest JSON listing N
# (scene_path, out_png, width, height) tuples and renders each
# sequentially in a single Godot process — replaces the per-frame
# fork-and-spawn pattern that drove the OOM at high frame counts.
#
# Invocation:
#
#   godot --audio-driver Dummy --rendering-driver opengl3 \
#         --path <project_dir> -s render-batch.gd -- <manifest_json> <output_dir>
#
# Manifest shape (UTF-8 JSON in <project_dir>/<manifest_json>):
#   [
#     {"scene": "res://scene_001.tscn", "out": "frame_001.png", "w": 200, "h": 200},
#     {"scene": "res://scene_002.tscn", "out": "frame_002.png", "w": 140, "h": 100},
#     ...
#   ]
#
# `out` is interpreted relative to <output_dir>.
#
# Per-frame flow: load scene → swap into SubViewport → tick 2 frames →
# get_texture().get_image().save_png() → continue. The SubViewport is
# reused across frames; only its size and child are swapped.

var _manifest: Array = []
var _output_dir: String = ""
var _index: int = 0
var _frames_remaining: int = 0
var _sub_viewport: SubViewport = null
var _current_instance: Node = null

func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() != 2:
		printerr("usage: render-batch.gd <manifest_json> <output_dir>")
		quit(2)
		return
	var manifest_path := args[0]
	_output_dir = args[1]

	var bytes := FileAccess.get_file_as_bytes(manifest_path)
	if bytes.size() == 0:
		printerr("manifest empty or unreadable: %s" % manifest_path)
		quit(2)
		return
	var json := JSON.new()
	var err := json.parse(bytes.get_string_from_utf8())
	if err != OK:
		printerr("manifest JSON parse failed (err %d) at line %d" % [err, json.get_error_line()])
		quit(2)
		return
	if typeof(json.data) != TYPE_ARRAY:
		printerr("manifest root must be an array")
		quit(2)
		return
	_manifest = json.data
	if _manifest.is_empty():
		printerr("manifest is empty — nothing to render")
		quit(0)
		return

	_sub_viewport = SubViewport.new()
	_sub_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_sub_viewport.transparent_bg = false
	_sub_viewport.disable_3d = true
	root.add_child(_sub_viewport)
	_load_current()

func _load_current() -> void:
	if _current_instance != null:
		_current_instance.queue_free()
		_current_instance = null
	var entry: Dictionary = _manifest[_index]
	var scene_path: String = entry.get("scene", "")
	var w: int = int(entry.get("w", 0))
	var h: int = int(entry.get("h", 0))
	if scene_path.is_empty() or w <= 0 or h <= 0:
		printerr("manifest entry %d invalid: %s" % [_index, JSON.stringify(entry)])
		quit(1)
		return
	var packed: Resource = ResourceLoader.load(scene_path, "PackedScene")
	if packed == null:
		printerr("manifest entry %d: failed to load scene %s" % [_index, scene_path])
		quit(1)
		return
	_current_instance = (packed as PackedScene).instantiate()
	if _current_instance == null:
		printerr("manifest entry %d: instantiate failed for %s" % [_index, scene_path])
		quit(1)
		return
	_sub_viewport.size = Vector2i(w, h)
	_sub_viewport.add_child(_current_instance)
	_frames_remaining = 2

func _process(_delta: float) -> bool:
	_frames_remaining -= 1
	if _frames_remaining > 0:
		return false
	# Capture current.
	var entry: Dictionary = _manifest[_index]
	var out_rel: String = entry.get("out", "")
	if out_rel.is_empty():
		printerr("manifest entry %d missing 'out'" % _index)
		quit(1)
		return true
	var texture := _sub_viewport.get_texture()
	if texture == null:
		printerr("entry %d: viewport texture is null" % _index)
		quit(1)
		return true
	var image: Image = texture.get_image()
	if image == null:
		printerr("entry %d: viewport image is null" % _index)
		quit(1)
		return true
	var out_path := _output_dir.path_join(out_rel)
	var save_err := image.save_png(out_path)
	if save_err != OK:
		printerr("entry %d: save_png failed (err %d): %s" % [_index, save_err, out_path])
		quit(1)
		return true
	# Advance.
	_index += 1
	if _index >= _manifest.size():
		quit(0)
		return true
	_load_current()
	return false
