export const config = {
  listName: "Tile has state",
  displayText: "{my}: Tile at ({0}, {1}) has state {2}",
  description: "Check if a tile at the given grid position has the specified state. Use this to query tile properties before actions.",
  isInvertible: true,
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate (tile number)", type: "number", initialValue: "0" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate (tile number)", type: "number", initialValue: "0" },
    { id: "state", name: "State", desc: "Tile state to check for", type: "combo", initialValue: "solid",
      items: [
        { solid: "Solid" },
        { clear: "Clear" },
        { jump_thru: "Jump-thru" },
        { avoid: "Avoid" },
        { slope: "Slope (any)" },
        { gentle_slope: "Gentle slope (22.5°)" }
      ]
    }
  ]
};

export const expose = true;

export default function (gx, gy, state) {
  const s = this._combo(state, ["solid", "clear", "jump_thru", "avoid", "slope", "gentle_slope"]);
  const tileState = this.aceGetTileState(gx, gy);
  if (s === "slope") {
    return tileState === "slope_left" || tileState === "slope_right" || tileState === "gentle_slope_left" || tileState === "gentle_slope_right";
  }
  if (s === "gentle_slope") {
    return tileState === "gentle_slope_left" || tileState === "gentle_slope_right";
  }
  return tileState === s;
}
