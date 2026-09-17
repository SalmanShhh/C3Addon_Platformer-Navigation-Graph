export const config = {
  listName: "Set max paths per tick",
  displayText: "{my}: Set max paths per tick to {0}",
  description: "Set how many pathfinding requests can be processed per game tick. Higher values reduce latency but increase CPU cost per frame. Default is 1.",
  params: [
    { id: "count", name: "Count", desc: "Maximum number of paths to process per tick", type: "number", initialValue: "1" }
  ]
};

export const expose = true;

export default function (count) {
  this.aceSetMaxPathsPerTick(count);
}
