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
# Per-frame flow: load scene → swap into a fresh SubViewport →
# await `RenderingServer.frame_post_draw` twice so the SubViewport's
# render-target texture has the new contents → save_png. The earlier
# `_process` tick-counter approach was non-deterministic at scale
# (one in three full-batch runs produced 15 blank scenes out of 20)
# because the number of ticks the SubViewport needed before its
# texture caught up depended on scene complexity AND on other
# scenes' resource churn in the same batch. Awaiting the actual
# render-complete signal eliminates the race regardless of scene
# count or shape.

var _manifest: Array = []
var _output_dir: String = ""

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

	# Drive the batch as a coroutine so we can await the real
	# render-complete signal between scenes instead of guessing
	# how many _process ticks the renderer needs.
	_run_batch()

func _run_batch() -> void:
	for i in range(_manifest.size()):
		var entry: Dictionary = _manifest[i]
		var ok := await _render_one(i, entry)
		if not ok:
			quit(1)
			return
	quit(0)

func _render_one(index: int, entry: Dictionary) -> bool:
	var scene_path: String = entry.get("scene", "")
	var w: int = int(entry.get("w", 0))
	var h: int = int(entry.get("h", 0))
	var out_rel: String = entry.get("out", "")
	if scene_path.is_empty() or w <= 0 or h <= 0 or out_rel.is_empty():
		printerr("manifest entry %d invalid: %s" % [index, JSON.stringify(entry)])
		return false
	var packed: Resource = ResourceLoader.load(scene_path, "PackedScene")
	if packed == null:
		printerr("manifest entry %d: failed to load scene %s" % [index, scene_path])
		return false
	var instance: Node = (packed as PackedScene).instantiate()
	if instance == null:
		printerr("manifest entry %d: instantiate failed for %s" % [index, scene_path])
		return false

	# Fresh SubViewport per scene. Reusing one across multiple
	# scenes left state (clear-color, render-target tex, child
	# layout) bleeding from scene N into scene N+1 — typically as
	# 100%-mismatched output.
	var sub_viewport := SubViewport.new()
	sub_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	sub_viewport.transparent_bg = false
	sub_viewport.disable_3d = true
	sub_viewport.size = Vector2i(w, h)
	sub_viewport.add_child(instance)
	root.add_child(sub_viewport)

	# Wait for two full render passes:
	#   1. First pass — the renderer initialises the SubViewport's
	#      render target and submits all queued draws.
	#   2. Second pass — the SubViewport's texture sampler picks
	#      up the freshly-rendered contents. Without this second
	#      wait, `get_texture().get_image()` returns the previous
	#      scene's framebuffer (or a blank one on the first scene)
	#      because the GPU hasn't published the result yet.
	# Both waits are anchored on `RenderingServer.frame_post_draw`,
	# which fires *after* the GPU completes the draw — same signal
	# Godot itself uses to schedule its sync points. This is the
	# deterministic equivalent of the old "tick N _process frames"
	# heuristic.
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw

	var texture := sub_viewport.get_texture()
	if texture == null:
		printerr("entry %d: viewport texture is null" % index)
		_teardown(sub_viewport)
		return false
	var image: Image = texture.get_image()
	if image == null:
		printerr("entry %d: viewport image is null" % index)
		_teardown(sub_viewport)
		return false
	var out_path := _output_dir.path_join(out_rel)
	var save_err := image.save_png(out_path)
	if save_err != OK:
		printerr("entry %d: save_png failed (err %d): %s" % [index, save_err, out_path])
		_teardown(sub_viewport)
		return false
	_teardown(sub_viewport)
	return true

func _teardown(sub_viewport: SubViewport) -> void:
	root.remove_child(sub_viewport)
	sub_viewport.queue_free()
