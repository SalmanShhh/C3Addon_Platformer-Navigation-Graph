export const config = {
  listName: "Set multiplayer mode",
  displayText: "{my}: Set multiplayer mode to {0}",
  description: "Choose where this character navigates in a multiplayer game. By default it runs only on the host and pauses itself on peers.",
  params: [
    {
      id: "mode",
      name: "Mode",
      desc: "Host only: navigation runs on the host and pauses automatically on peers, which receive the synced positions instead (offline games are unaffected). Run everywhere: navigation always runs on this machine, for local-only characters that are never synced.",
      type: "combo",
      initialValue: "host_only",
      items: [
        { host_only: "Host only (automatic)" },
        { everywhere: "Run everywhere" }
      ]
    }
  ]
};

export const expose = true;

export default function (mode) {
  this.aceSetMultiplayerMode(this._combo(mode, ["host_only", "everywhere"]));
}
