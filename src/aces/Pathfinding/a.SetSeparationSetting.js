export const config = {
  listName: "Set separation setting",
  displayText: "{my}: Set separation {0} to {1}",
  description: "Change an idle separation setting: Distance (personal space in pixels, 0 = off), Cooldown (rest after giving up, in seconds, 0 = never rest), or Give-up time (trying time before resting, in seconds).",
  params: [
    {
      id: "setting",
      name: "Setting",
      desc: "Distance: personal space, in pixels (0 = off). Cooldown: rest after giving up, in seconds (0 = never rest). Give-up time: trying time before resting, in seconds.",
      type: "combo",
      initialValue: "distance",
      items: [
        { distance: "Distance" },
        { cooldown: "Cooldown" },
        { give_up: "Give-up time" }
      ]
    },
    { id: "value", name: "Value", desc: "The value, in pixels for Distance or seconds otherwise.", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (setting, value) {
  const key = this._combo(setting, ["distance", "cooldown", "give_up"]);
  if (key === "distance") this.aceSetIdleSeparation(value);
  else if (key === "cooldown") this.aceSetSeparationCooldown(value);
  else this.aceSetSeparationGiveUpTime(value);
}
