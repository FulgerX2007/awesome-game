#!/usr/bin/env python3
"""MathMagic: converts the ground decor of Quaternius' Ultimate Stylized Nature Pack (May 2022, CC0) from the
supplied AllModels.blend into glTF for Godot: godot/mathmagic/assets/models/nature/<Name>.gltf + .bin, with the
textures shared in nature/textures/ and shrunk to 512 px.
Only models whose textures are packed in the .blend are exported (bushes, flowers, grass, plants); the trees and
rocks in that file reference textures that were never packed and would render blank.
Needs Blender as a Python module (pip install bpy==4.5.9 into a Python 3.11 venv):
    python -I tools/mathmagic/nature.py /path/to/AllModels.blend
The .blend is opened with its embedded scripts disabled.
"""
import os
import sys

import bpy

MODELS = ["Bush", "Bush_Flowers", "Bush_Large", "Bush_Large_Flowers", "Bush_Small", "Bush_Small_Flowers",
          "Flower_1_Clump", "Flower_2_Clump", "Flower_3_Clump", "Flower_4_Clump", "Flower_5_Clump",
          "Grass_Large", "Grass_Small", "Plant_1", "Plant_2", "Plant_Flowers"]
TEXTURE_SIZE = 512
OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../godot/mathmagic/assets/models/nature"))


def main(blend: str) -> None:
    bpy.ops.wm.open_mainfile(filepath=blend, load_ui=False, use_scripts=False)
    os.makedirs(OUT, exist_ok=True)
    for img in bpy.data.images:
        if img.packed_file and img.size[0] > TEXTURE_SIZE:
            img.scale(TEXTURE_SIZE, TEXTURE_SIZE)
    for name in MODELS:
        o = bpy.data.objects.get(name)
        if o is None or o.type != "MESH":
            sys.exit(f"{name}: not in {blend}")
        for slot in o.material_slots:
            for node in (slot.material.node_tree.nodes if slot.material and slot.material.node_tree else []):
                if node.type == "TEX_IMAGE" and node.image and not node.image.packed_file:
                    sys.exit(f"{name}: texture {node.image.name} is not packed in the .blend")
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        loc = o.location.copy()
        o.location = (0, 0, 0)
        bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + ".gltf"), use_selection=True,
                                  export_format="GLTF_SEPARATE", export_texture_dir="textures",
                                  export_apply=True, export_yup=True)
        o.location = loc
    print(f"wrote {len(MODELS)} models to {OUT}")


if __name__ == "__main__":
    main(sys.argv[-1])
