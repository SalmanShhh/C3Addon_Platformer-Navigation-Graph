export const config = {
  listName: "Set max traversal drop",
  displayText: "{my}: Set max traversal drop to {0} px",
  description: "Limit how far down this character will ever descend by air: jumps and falls with a larger net drop are excluded from its paths, so it descends via slopes and portals instead. For heavy units and fall damage.",
  params: [
    { id: "pixels", name: "Drop", desc: "The maximum downward drop, in pixels. 0 never descends by air. -1 removes the limit.", type: "number", initialValue: "-1" }
  ]
};

export const expose = true;

export default function (pixels) {
  this.maxTraversalDrop = typeof pixels === "number" ? pixels : -1;
}
