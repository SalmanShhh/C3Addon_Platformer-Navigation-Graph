export const config = {
  listName: "Set ledge leniency",
  displayText: "Set ledge leniency to {0} pixels",
  description: "Set how many pixels past a platform edge the AI can walk before stopping (0 = strict stop). Increase for more natural-looking patrol movement near edges. Only used when ledge restriction is enabled.",
  params: [
    { id: "pixels", name: "Pixels", desc: "Pixels past ledge edge before stopping", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (pixels) {
  this.ledgeLeniency = pixels;
}
