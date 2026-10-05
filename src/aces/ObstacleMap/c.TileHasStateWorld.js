export const config = {
  listName: "Tile has state at world position",
  displayText: "{my}: Tile at world ({0}, {1}) has state {2}",
  description: "Check if a tile at the given world position has the specified state. World coordinates are automatically converted to grid coordinates.",
  isInvertible: true,
  params: [
    { id: "x", name: "X", desc: "The X co-ordinate, in pixels.", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "The Y co-ordinate, in pixels.", type: "number", initialValue: "0" },
    { id: "state", name: "State", desc: "Solid blocks movement. Clear is open space. Jump-thru is a one-way platform. Avoid is walkable but costly. Slope (any) matches every slope type; Gentle slope matches only 22.5° tiles.", type: "combo", initialValue: "solid",
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

export default function (x, y, state) {
  const s = this._combo(state, ["solid", "clear", "jump_thru", "avoid", "slope", "gentle_slope"]);
  const tileState = this.aceGetTileStateWorld(x, y);
  if (s === "slope") {
    return tileState === "slope_left" || tileState === "slope_right" || tileState === "gentle_slope_left" || tileState === "gentle_slope_right";
  }
  if (s === "gentle_slope") {
    return tileState === "gentle_slope_left" || tileState === "gentle_slope_right";
  }
  return tileState === s;
}
