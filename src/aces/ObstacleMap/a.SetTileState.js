export const config = {
  listName: "Set tile state",
  displayText: "{my}: Set tile at ({0}, {1}) to {2}",
  description: "Set the state of a tile at the specified grid coordinates. Use this to mark tiles as solid obstacles, clear space, jump-thru platforms, areas to avoid, or slopes.",
  params: [
    { id: "gx", name: "Grid X", desc: "The tile X co-ordinate.", type: "number", initialValue: "0" },
    { id: "gy", name: "Grid Y", desc: "The tile Y co-ordinate.", type: "number", initialValue: "0" },
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

export default function (gx, gy, state) {
  this.aceSetTileState(gx, gy, this._combo(state, ["solid", "clear", "jump_thru", "avoid", "slope_left", "slope_right", "gentle_slope_left", "gentle_slope_right"]));
}
