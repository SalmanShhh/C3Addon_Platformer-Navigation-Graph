export const config = {
  listName: "Use Pathfinding obstacle map",
  displayText: "Use Pathfinding obstacle map [Auto-regenerate: {0}]",
  description: "Use the obstacle map from the Pathfinding behavior instead of a custom map. Enable auto-regenerate to automatically rebuild the graph when the Pathfinding map changes.",
  params: [
    { id: "autoRegen", name: "Auto-regenerate", desc: "Automatically regenerate graph when Pathfinding map changes", type: "combo", initialValue: "yes",
      items: [{ yes: "Yes" }, { no: "No" }]
    }
  ]
};

export const expose = true;

export default function (autoRegen) {
  this.aceUsePathfindingObstacleMap(this._combo(autoRegen, ["yes", "no"]) === "yes");
}
