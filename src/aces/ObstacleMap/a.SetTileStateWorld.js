export const config = {
  listName: "Set tile state at world position",
  displayText: "{my}: Set tile at world ({0}, {1}) to {2}",
  description: "Set the state of a tile at the specified world coordinates. The world position is automatically converted to grid coordinates.",
  params: [
    { id: "x", name: "X", desc: "The X co-ordinate, in pixels.", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "The Y co-ordinate, in pixels.", type: "number", initialValue: "0" },
    { id: "state", name: "State", desc: "The tile state to set.", type: "combo", initialValue: "solid",
      items: [
        { solid: "Solid" },
        { clear: "Clear" },
        { jump_thru: "Jump-thru" },
        { avoid: "Avoid" },
        { slope_left: "Slope left / (45°)" },
        { slope_right: "Slope right \\ (45°)" },
        { gentle_slope_left: "Gentle slope left / (22.5°)" },
        { gentle_slope_right: "Gentle slope right \\ (22.5°)" }
      ]
    }
  ]
};

export const expose = true;

export default function (x, y, state) {
  this.aceSetTileStateWorld(x, y, this._combo(state, ["solid", "clear", "jump_thru", "avoid", "slope_left", "slope_right", "gentle_slope_left", "gentle_slope_right"]));
}
