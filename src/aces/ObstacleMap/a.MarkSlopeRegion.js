export const config = {
  listName: "Mark slope region",
  displayText: "{my}: Mark slope from ({0},{1}) to ({2},{3}) as {4}",
  description: "Mark a diagonal region of tiles as slope. Specify the start and end grid corners. All tiles along the diagonal will be marked as slope with the given direction.",
  params: [
    { id: "startGx", name: "Start X", desc: "The starting tile X co-ordinate.", type: "number", initialValue: "0" },
    { id: "startGy", name: "Start Y", desc: "The starting tile Y co-ordinate.", type: "number", initialValue: "0" },
    { id: "endGx", name: "End X", desc: "The ending tile X co-ordinate.", type: "number", initialValue: "5" },
    { id: "endGy", name: "End Y", desc: "The ending tile Y co-ordinate.", type: "number", initialValue: "5" },
    { id: "direction", name: "Direction", desc: "The slope shape and steepness: the / and \\ glyphs show which way the surface rises, 45° is steep, 22.5° is gentle (2 tiles per 1 of height).", type: "combo", initialValue: "slope_left",
      items: [
        { slope_left: "Slope left / (45°)" },
        { slope_right: "Slope right \\ (45°)" },
        { gentle_slope_left: "Gentle slope left / (22.5°)" },
        { gentle_slope_right: "Gentle slope right \\ (22.5°)" }
      ]
    }
  ]
};

export const expose = true;

export default function (startGx, startGy, endGx, endGy, direction) {
  this.aceMarkSlopeRegion(startGx, startGy, endGx, endGy, this._combo(direction, ["slope_left", "slope_right", "gentle_slope_left", "gentle_slope_right"]));
}
