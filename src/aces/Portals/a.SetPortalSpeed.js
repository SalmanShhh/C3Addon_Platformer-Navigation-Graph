export const config = {
  listName: "Set portal speed",
  displayText: "{my}: Set portal {0} speed to {1}",
  description: "Change the movement speed of a gradual portal (pixels per second). Has no effect on instant portals.",
  params: [
    { id: "portalId", name: "Portal ID", desc: "The ID of the portal to configure", type: "number", initialValue: "0" },
    { id: "speed", name: "Speed", desc: "Movement speed in pixels per second", type: "number", initialValue: "100" }
  ]
};

export const expose = true;

export default function (portalId, speed) {
  this.aceSetPortalSpeed(portalId, speed);
}
