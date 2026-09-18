export const config = {
  listName: "Set idle separation",
  displayText: "{my}: Set idle separation to {0} px",
  description: "Set the personal space in pixels for characters with no active path: idle characters closer than this to another character on the same map gently push apart. 0 disables it. Ledge-safe and never interferes with path following.",
  params: [
    { id: "pixels", name: "Pixels", desc: "The minimum spacing between idle characters, in pixels. 0 disables it.", type: "number", initialValue: "32" }
  ]
};

export const expose = true;

export default function (pixels) {
  this.aceSetIdleSeparation(pixels);
}
