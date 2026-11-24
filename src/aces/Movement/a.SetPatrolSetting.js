export const config = {
  listName: "Set patrol setting",
  displayText: "{my}: Set patrol {0} to {1}",
  description: "Tune patrolling. Settings belong to the character and apply to both Start patrol and Start patrol between objects.",
  params: [
    { id: "setting", name: "Setting", desc: "Dwell time: the wait at each end or marker, in seconds. Edge distance: how far short of each platform edge to turn, in pixels (Start patrol only). Dwell variation: a random amount, in seconds, added to or taken from each wait so guards do not move in step. Speed: the walking speed while patrolling, as a percentage of the Platform behavior's max speed (chases and jumps use full speed). Resume after: how long, in seconds, the character waits after a Find path ends before resuming the patrol that Find path cancelled (0 = never).", type: "combo", initialValue: "dwell",
      // Item order is immutable (combo values stored by index); append new settings at the end.
      items: [
        { dwell: "Dwell time" },
        { edge_distance: "Edge distance" },
        { dwell_variation: "Dwell variation" },
        { speed: "Speed" },
        { resume_after: "Resume after" }
      ]
    },
    { id: "value", name: "Value", desc: "The new value: seconds for Dwell time, Dwell variation and Resume after, pixels for Edge distance, a percentage for Speed.", type: "number", initialValue: "1" }
  ]
};

export const expose = true;

export default function (setting, value) {
  this.aceSetPatrolSetting(this._combo(setting, ["dwell", "edge_distance", "dwell_variation", "speed", "resume_after"]), value);
}
