export const config = {
  listName: "Set separation cooldown",
  displayText: "{my}: Set separation cooldown to {0} seconds",
  description: "Set how long characters rest after giving up on idle separation (when the crowd is too dense for the spacing to be satisfied) before trying again. 0 = never rest, keep trying continuously.",
  params: [
    { id: "seconds", name: "Seconds", desc: "The rest time after giving up, in seconds. 0 means never rest.", type: "number", initialValue: "5" }
  ]
};

export const expose = true;

export default function (seconds) {
  this.aceSetSeparationCooldown(seconds);
}
