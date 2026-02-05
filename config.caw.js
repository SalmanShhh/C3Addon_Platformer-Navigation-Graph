import {
  ADDON_CATEGORY,
  ADDON_TYPE,
  PLUGIN_TYPE,
  PROPERTY_TYPE,
} from "./template/enums.js";
import _version from "./version.js";
export const addonType = ADDON_TYPE.BEHAVIOR;
export const type = PLUGIN_TYPE.OBJECT;
export const id = "salmanshh_platformer_navigationgraph";
export const name = "Platformer Navigation Graph";
export const version = _version;
export const minConstructVersion = undefined;
export const author = "SalmanShh";
export const website = "https://www.construct.net";
export const documentation = "https://www.construct.net";
export const description = "AI pathfinding for platformer games with jumping and falling";
export const category = ADDON_CATEGORY.MOVEMENTS;

export const hasDomside = false;
export const files = {
  extensionScript: {
    enabled: false, // set to false to disable the extension script
    watch: true, // set to true to enable live reload on changes during development
    targets: ["x86", "x64"],
    // you don't need to change this, the build step will rename the dll for you. Only change this if you change the name of the dll exported by Visual Studio
    name: "MyExtension",
  },
  fileDependencies: [],
  remoteFileDependencies: [
    // {
    //   src: "https://example.com/api.js", // Must use https:// or same-protocol // URLs. http:// is not allowed.
    //   type: "" // Optional: "" or "module". Empty string or omit for classic script.
    // }
  ],
  cordovaPluginReferences: [],
  cordovaResourceFiles: [],
};

// categories that are not filled will use the folder name
export const aceCategories = {};

export const info = {
  // icon: "icon.svg",
  // PLUGIN world only
  // defaultImageUrl: "default-image.png",
  Set: {
    // COMMON to all
    CanBeBundled: true,
    IsDeprecated: false,
    GooglePlayServicesEnabled: false,

    // BEHAVIOR only
    IsOnlyOneAllowed: false,

    // PLUGIN world only
    IsResizable: false,
    IsRotatable: false,
    Is3D: false,
    HasImage: false,
    IsTiled: false,
    SupportsZElevation: false,
    SupportsColor: false,
    SupportsEffects: false,
    MustPreDraw: false,

    // PLUGIN object only
    IsSingleGlobal: true,
  },
  // PLUGIN only
  AddCommonACEs: {
    Position: false,
    SceneGraph: false,
    Size: false,
    Angle: false,
    Appearance: false,
    ZOrder: false,
  },
};

export const properties = [

  // Property [0]
  {
    type: PROPERTY_TYPE.CHECK,
    id: "enable_debug",
    name: "Enable Debug Logging",
    desc: "Show helpful debug messages in browser console (F12) to troubleshoot pathfinding issues. Disable for better performance in final game.",
    options: { initialValue: true }
  },

  // Property [1]
  {
    type: PROPERTY_TYPE.INTEGER,
    id: "cell_size",
    name: "Cell Size",
    desc: "Size of each grid square in pixels. MUST match the Cell Size in your Pathfinding behavior! Smaller = more precise paths but slower performance.",
    options: {
      initialValue: 32,
      minValue: 8,
      maxValue: 128
    }
  },
  
  // Property [2]
  {
    type: PROPERTY_TYPE.INTEGER,
    id: "character_height",
    name: "Character Height",
    desc: "Height of your character in pixels. Used to check if character can fit under platforms when jumping or moving. Should match your sprite's collision box height.",
    options: {
      initialValue: 32,
      minValue: 8,
      maxValue: 128
    }
  },
  
  // Property [3]
  {
    type: PROPERTY_TYPE.INTEGER,
    id: "max_search_nodes",
    name: "Max Search Nodes",
    desc: "Maximum pathfinding effort before giving up. Higher = finds paths in larger levels but may cause lag. Lower = faster but may fail on complex paths.",
    options: {
      initialValue: 2000,
      minValue: 100,
      maxValue: 10000
    }
  },

  // Property [4]
  {
    type: PROPERTY_TYPE.COMBO,
    id: "setup_preset",
    name: "Setup Preset",
    desc: "Pre-configured jump/fall settings. Auto: detects from Platform behavior. Beginner: short jumps, safe falls. Intermediate: moderate mobility. Advanced: maximum jump/fall distances for complex levels.",
    options: {
      initialValue: "auto",
      items: [
        { auto: "Auto (detect from Platform behavior)" },
        { beginner: "Beginner (short jumps, safe falls)" },
        { intermediate: "Intermediate (moderate mobility)" },
        { advanced: "Advanced (maximum distances)" }
      ]
    }
  },

  // Property [5]
  {
    type: PROPERTY_TYPE.INTEGER,
    id: "max_jump_height",
    name: "Max Jump Height",
    desc: "Highest platform your character can jump to reach (in pixels). Should match your Platform behavior's jump strength. AI will only attempt jumps within this limit.",
    options: {
      initialValue: 128,
      minValue: 16,
      maxValue: 512
    }
  },

  // Property [6]
  {
    type: PROPERTY_TYPE.INTEGER,
    id: "max_jump_distance",
    name: "Max Jump Distance",
    desc: "Farthest gap your character can jump across (in pixels). Should match your character's movement speed and jump duration. AI won't attempt longer jumps.",
    options: {
      initialValue: 192,
      minValue: 32,
      maxValue: 512
    }
  },

  // Property [7]
  {
    type: PROPERTY_TYPE.INTEGER,
    id: "max_fall_distance",
    name: "Max Fall Distance",
    desc: "Maximum height your character can safely fall from (in pixels). AI will avoid longer drops that might cause damage or death in your game.",
    options: {
      initialValue: 256,
      minValue: 32,
      maxValue: 1024
    }
  },

  // Property [8]
  {
    type: PROPERTY_TYPE.CHECK,
    id: "auto_control",
    name: "Auto-Control Movement",
    desc: "When enabled, AI automatically controls the character (moves left/right, jumps). When disabled, you handle movement yourself using the path data.",
    options: { initialValue: true }
  },

  // Property [9]
  {
    type: PROPERTY_TYPE.COMBO,
    id: "graph_mode",
    name: "Graph Mode",
    desc: "How navigation data is stored. Shared = all characters use same map (efficient). Per-Instance = each character has own map (rare use cases only).",
    options: {
      initialValue: "shared",
      items: [
        { instance: "Per-Instance" },
        { shared: "Shared (recommended)" }
      ]
    }
  },

  // Property [10]
  {
    type: PROPERTY_TYPE.CHECK,
    id: "enable_portals",
    name: "Enable Portals",
    desc: "Allow AI to use special connections like teleporters, ladders, elevators, or doors. Disable if your game doesn't have these features.",
    options: { initialValue: true }
  },

  // Property [11]
  {
    type: PROPERTY_TYPE.CHECK,
    id: "smooth_paths",
    name: "Smooth Paths",
    desc: "Remove unnecessary waypoints for more natural movement. AI will take direct routes when possible instead of zigzagging.",
    options: { initialValue: true }
  },

  // Property [12]
  {
    type: PROPERTY_TYPE.FLOAT,
    id: "max_waypoint_time",
    name: "Max Waypoint Time",
    desc: "How long (in seconds) AI tries to reach each waypoint before giving up and recalculating path. Prevents infinite loops when stuck.",
    options: {
      initialValue: 5.0,
      minValue: 1.0,
      maxValue: 30.0
    }
  },

  // Property [13]
  {
    type: PROPERTY_TYPE.CHECK,
    id: "enable_hazards",
    name: "Enable Hazard Avoidance",
    desc: "AI will try to avoid dangerous areas like spikes, fire, or enemy patrol zones. Makes pathfinding slower but smarter.",
    options: {
      initialValue: false
    }
  }
];
