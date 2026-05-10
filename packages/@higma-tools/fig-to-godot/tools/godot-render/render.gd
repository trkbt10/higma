@tool
extends SceneTree

# Headless render driver invoked via:
#
#   godot --path <project_dir> -s render.gd -- <scene_res_path> <out_png> <width> <height>
#
# `<scene_res_path>` must be a `res://` path (Godot's ResourceLoader
# only accepts project-rooted paths). The Node.js driver writes the
# scene to `<project_dir>/scene.tscn` and passes `res://scene.tscn` so
# the loader can resolve it.
#
# Frame ticking: `_initialize` runs before the main loop starts, so
# `await process_frame` would deadlock. Instead we kick off the work
# in `_initialize` and finish it in `_process` after the SceneTree has
# advanced one tick — that's the only callback that runs after the
# rendering server has actually drawn at least one frame.
#
# The script:
#   1. Loads the scene from the absolute path.
#   2. Sizes the root viewport to (width, height) so the rendered image
#      matches the authored frame dimensions exactly.
#   3. Adds the scene root to the SceneTree.
#   4. Waits one frame so the rendering server has a chance to draw.
#   5. Snaps the viewport texture to a PNG file.
#   6. Quits.
#
# All errors (missing arg, load failure, save failure) call quit(1) so
# the parent process can fail-fast.

var _out_png: String = ""
var _sub_viewport: SubViewport = null
var _frames_remaining: int = 2

func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() != 4:
		printerr("usage: render.gd <scene_path> <out_png> <width> <height>")
		quit(2)
		return
	var scene_path := args[0]
	_out_png = args[1]
	var width := args[2].to_int()
	var height := args[3].to_int()
	if width <= 0 or height <= 0:
		printerr("width/height must be positive integers (got %s x %s)" % [args[2], args[3]])
		quit(2)
		return

	var packed: Resource = ResourceLoader.load(scene_path, "PackedScene")
	if packed == null:
		printerr("failed to load scene: %s" % scene_path)
		quit(1)
		return

	var instance: Node = (packed as PackedScene).instantiate()
	if instance == null:
		printerr("failed to instantiate scene: %s" % scene_path)
		quit(1)
		return

	# Use a SubViewport with explicit RenderTarget update mode so
	# `viewport.get_texture()` returns a populated texture even when
	# `--display-driver headless` produces no native window. The
	# SubViewport owns its own RenderTarget and is independent of the
	# Window viewport.
	_sub_viewport = SubViewport.new()
	_sub_viewport.size = Vector2i(width, height)
	_sub_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_sub_viewport.transparent_bg = false
	_sub_viewport.disable_3d = true
	_sub_viewport.add_child(instance)
	root.add_child(_sub_viewport)

# `process` is called once per frame after `_initialize`. `_initialize`
# cannot await `process_frame` because the main loop has not started
# yet — this callback is the only place a SceneTree script can wait on
# the renderer.
func _process(_delta: float) -> bool:
	# Skip the first tick so the layout containers measure once, then
	# capture on the second tick after the SubViewport's RenderTarget
	# has been drawn at least once.
	_frames_remaining -= 1
	if _frames_remaining > 0:
		return false  # continue ticking
	if _sub_viewport == null:
		printerr("internal error: _sub_viewport not set")
		quit(1)
		return true
	var texture := _sub_viewport.get_texture()
	if texture == null:
		printerr("failed to capture viewport image (texture is null)")
		quit(1)
		return true
	var image: Image = texture.get_image()
	if image == null:
		printerr("failed to capture viewport image (image is null)")
		quit(1)
		return true
	var save_err := image.save_png(_out_png)
	if save_err != OK:
		printerr("save_png failed (err %d): %s" % [save_err, _out_png])
		quit(1)
		return true
	quit(0)
	return true  # ask the SceneTree to stop ticking after this frame
