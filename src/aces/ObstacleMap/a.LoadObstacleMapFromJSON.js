export const config = {
  listName: "Load obstacle map from JSON",
  displayText: "{my}: Load obstacle map from JSON: {0}",
  description: "Load a previously saved obstacle map from JSON string. Use this to restore saved maps or load pre-built level data.",
  params: [
    { id: "json", name: "JSON", desc: "JSON string containing obstacle map data", type: "string", initialValue: '""' }
  ]
};

export const expose = true;

export default function (json) {
  this.aceLoadObstacleMapFromJSON(json);
}
