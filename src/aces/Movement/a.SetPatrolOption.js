export const config = {
  listName: "Set patrol option",
  displayText: "{my}: Set patrol option {0}: {1}",
  description: "Turn one of the automatic patrol behaviors on or off. Both are on by default.",
  params: [
    { id: "option", name: "Option", desc: "Turn at characters: turn around when another character stands in the way (two patrollers meeting head-on both turn). Turn before danger: turn around before stepping somewhere more hazardous than the current spot.", type: "combo", initialValue: "turn_at_characters",
      // Item order is immutable (combo values stored by index); append new options at the end.
      items: [{ turn_at_characters: "Turn at characters" }, { turn_before_danger: "Turn before danger" }]
    },
    { id: "state", name: "State", desc: "Whether to enable or disable the option.", type: "combo", initialValue: "enabled",
      items: [{ enabled: "Enabled" }, { disabled: "Disabled" }]
    }
  ]
};

export const expose = true;

export default function (option, state) {
  this.aceSetPatrolOption(
    this._combo(option, ["turn_at_characters", "turn_before_danger"]),
    this._combo(state, ["enabled", "disabled"]) === "enabled"
  );
}
