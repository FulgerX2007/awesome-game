"""Долгая зима on Godot: the one palette and the one light every asset generator uses.

Style "Stylized Premium Winter Survival": soft volumes, cold blue-violet shadows, warm orange fire, no pixel art,
no black outlines (an edge is a darker shade of the same hue). Import it from any generator under tools/winter-godot/:

    from palette import P, LIGHT, TILE, rgb, mix
"""

TILE = 96                         # one map tile, in texture and world pixels (sprites are drawn 1:1)
LIGHT = (-0.55, -0.65, 0.52)      # towards the sun: up-left and above (x right, y down, z out of the ground)
SHADOW_DIR = (0.62, 0.34)         # cast shadows fall down-right, flattened onto the ground (per unit of height)
AMBIENT = 0.42                    # how bright a face turned away from the sun still is

# Hex colours by role. Shadows lean blue-violet, lights lean warm-white; fire is the only saturated warm colour.
P = {
    # snow and ice
    "snow_hi": "#f4f8ff", "snow": "#dfe9f6", "snow_mid": "#c3d3ea", "snow_shade": "#9fb3d6", "snow_deep": "#7f95c2",
    "snow_night": "#3a4a78",
    "ice_hi": "#d8f1ff", "ice": "#9fd3ee", "ice_mid": "#6fb0d6", "ice_deep": "#3f7fb0", "water": "#1d3f66",
    # wood
    "bark_hi": "#8a6248", "bark": "#5e3f2d", "bark_dark": "#3a2620", "wood_hi": "#d9a46a", "wood": "#b07a48",
    "wood_dark": "#7a4f30", "wood_cut": "#e6c08a", "wood_grey": "#8b8079",
    # needles and plants
    "pine_hi": "#4f8a74", "pine": "#2f6457", "pine_dark": "#1c4040", "pine_deep": "#122c33",
    "moss": "#6f8f5a", "berry": "#d23a4a", "berry_hi": "#ff7a7f", "twig": "#6a4a3a",
    # stone and metal
    "stone_hi": "#b9bfcc", "stone": "#8a90a3", "stone_mid": "#6c7286", "stone_dark": "#474c60",
    "iron_hi": "#c9d2dc", "iron": "#7d8794", "rust": "#a5552f", "rust_dark": "#6b3420",
    # earth
    "earth_hi": "#8e7a66", "earth": "#6a5646", "earth_dark": "#43362e", "camp_ground": "#9a8a7c",
    # fire and light
    "fire_core": "#fff4c2", "fire_hi": "#ffd36a", "fire": "#ff9a2e", "fire_deep": "#e2541c", "ember": "#ff6a1a",
    "ember_dark": "#8f2a12", "smoke": "#8c93a3", "smoke_dark": "#565c6c", "glow_warm": "#ffb35a",
    # cloth and people
    "skin": "#e8b896", "skin_shade": "#b97f6a", "hair": "#5a3a2a", "fur": "#cbb79a", "fur_dark": "#8a755e",
    "coat_red": "#a83a32", "coat_blue": "#3c5f8f", "coat_green": "#4c6f4a", "coat_brown": "#7a5638",
    "coat_ochre": "#b98a3a", "wool": "#e9e2d6", "leather": "#6b4a32", "boot": "#3e2e28",
    # animals
    "wolf": "#8f96a6", "wolf_dark": "#555c6e", "wolf_eye": "#ffd25a", "rabbit": "#eef0f4", "deer": "#9a6e4c",
    "deer_light": "#d8bfa0", "bear": "#5a4032", "bear_dark": "#342520",
    # UI
    "ui_ink": "#eaf2ff", "ui_dim": "#9fb0cc", "ui_panel": "#1a2338", "ui_panel_hi": "#2a3755", "ui_line": "#46577e",
    "ui_frost": "#cfe6ff", "ui_warm": "#ffb35a", "ui_good": "#7fd18b", "ui_bad": "#ff6b5e", "ui_warn": "#ffcc4d",
    "stat_health": "#ff5f6d", "stat_warmth": "#ff9a3c", "stat_food": "#f0c24a", "stat_energy": "#6fd0ff",
}


def rgb(name_or_hex):
    """(r, g, b) floats 0..1 for a palette name or a #rrggbb string."""
    h = P.get(name_or_hex, name_or_hex).lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def mix(a, b, t):
    """Linear blend of two colours (names, hex or tuples)."""
    a = rgb(a) if isinstance(a, str) else a
    b = rgb(b) if isinstance(b, str) else b
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))
