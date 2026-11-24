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
export const website = "https://github.com/SalmanShhh/Platformer-Navigation-Graph-V2";
export const documentation = "https://github.com/SalmanShhh/Platformer-Navigation-Graph-V2/blob/main/Guide.md";
export const description = "Smart pathfinding for platformer games: characters jump gaps, drop between platforms, climb slopes, and take momentum leaps to reach their target. Add it next to the built-in Platform behavior and it works with zero setup events. Includes portals (doors, elevators, ziplines), hazard avoidance, path strategy presets, and crowd handling so groups surround a target instead of stacking.";
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

// categories that are not filled will use the folder name.
// Category layout mirrors the built-in Pathfinding behavior's groups
// (Pathfinding / Movement / Obstacles / Costs→Hazards), plus Portals and Debug.
export const aceCategories = {
  ObstacleMap: "Obstacles",
};

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
    desc: "Log navigation messages to the browser console (F12). Turn off for release.",
    options: { initialValue: false }
  },

  // Property [1]
  {
    type: PROPERTY_TYPE.INTEGER,
    id: "cell_size",
    name: "Tile Size",
    desc: "The grid tile size, in pixels. Match your tilemap's tile size. 0 = auto-detect.",
    options: {
      initialValue: 32,
      minValue: 0,
      maxValue: 128
    }
  },
  
  // Property [2]
  {
    type: PROPERTY_TYPE.INTEGER,
    id: "max_search_nodes",
    name: "Max Search Nodes",
    desc: "The most graph nodes a path search may visit before giving up. Higher finds longer paths but costs more.",
    options: {
      initialValue: 2000,
      minValue: 100,
      maxValue: 10000
    }
  },

  // Property [3]
  {
    type: PROPERTY_TYPE.INTEGER,
    id: "max_fall_distance",
    name: "Max Fall Distance",
    desc: "The longest fall allowed, in pixels. 0 = from the Platform behavior, -1 = unlimited.",
    options: { initialValue: 0 }
  },

  // Property [4]
  {
    type: PROPERTY_TYPE.CHECK,
    id: "auto_control",
    name: "Auto-Control Movement",
    desc: "Drive the Platform behavior automatically. Disable to move the character yourself from the path data.",
    options: { initialValue: true }
  },

  // Property [5]
  {
    type: PROPERTY_TYPE.COMBO,
    id: "path_strategy",
    name: "Path Strategy",
    desc: "How the character chooses between routes. Balanced: weighs distance and difficulty. Shortest Distance: the shortest route. Safest Route: short hops over long leaps. Ground-Hugging: walks whenever it can. No Falling: never drops down. Walk Only: never leaves its platform.",
    options: {
      initialValue: "balanced",
      items: [
        { balanced: "Balanced (recommended for most games)" },
        { shortest: "Shortest Distance (speedrunners, time trials)" },
        { safest: "Safest Route (stealth, escort missions)" },
        // Key stays "simplest" (combo values are stored by index/key; only
        // the display text may change). Rebranded Ground-Hugging in 0.7.0.0.
        { simplest: "Ground-Hugging (patrols, predictable AI)" },
        // Appended 0.9.0.0 (appending is index-safe; never reorder).
        { no_drop: "No Falling (heavy units, fall damage)" },
        { walk_only: "Walk Only (never leaves its platform)" }
      ]
    }
  },

  // Property [6]
  {
    type: PROPERTY_TYPE.CHECK,
    id: "smooth_paths",
    name: "Smooth Paths",
    desc: "Skip unneeded waypoints so characters walk directly instead of tile by tile.",
    options: { initialValue: true }
  },

  // Property [7]
  {
    type: PROPERTY_TYPE.FLOAT,
    id: "max_waypoint_time",
    name: "Max Waypoint Time",
    desc: "Seconds to reach each waypoint before giving up and triggering On waypoint stuck.",
    options: {
      initialValue: 5.0,
      minValue: 1.0,
      maxValue: 30.0
    }
  },

  // Property [8]
  {
    type: PROPERTY_TYPE.FLOAT,
    id: "coyote_time",
    name: "Coyote Time",
    desc: "Seconds after walking off a ledge in which a jump still works. Needs Ledge Restriction disabled. 0 = off.",
    options: {
      initialValue: 0,
      minValue: 0,
      maxValue: 1.0
    }
  },

  // Property [9]
  {
    type: PROPERTY_TYPE.CHECK,
    id: "strict_positioning",
    name: "Strict Jump Positioning",
    desc: "Slow down and line up on the take-off tile before each jump or fall, so jumps are not missed.",
    options: { initialValue: true }
  },

  // Property [10]
  {
    type: PROPERTY_TYPE.CHECK,
    id: "ledge_restriction",
    name: "Ledge Restriction",
    desc: "Stop at platform edges unless the path needs a jump or fall.",
    options: { initialValue: false }
  },

  // Property [11]
  {
    type: PROPERTY_TYPE.FLOAT,
    id: "ledge_leniency",
    name: "Ledge Leniency",
    desc: "How far past an edge the character may walk before stopping, in pixels. Needs Ledge Restriction.",
    options: {
      initialValue: 0,
      minValue: 0,
      maxValue: 64
    }
  },

  // Property [12]
  {
    type: PROPERTY_TYPE.FLOAT,
    id: "repath_threshold",
    name: "Re-Path Threshold",
    desc: "How far the character may drift from its path before re-pathing, in tiles. 0 = off.",
    options: {
      initialValue: 3.0,
      minValue: 0,
      maxValue: 20.0
    }
  },

  // Property [13]
  {
    type: PROPERTY_TYPE.INTEGER,
    id: "hazard_radius",
    name: "Hazard Radius",
    desc: "How far hazard costs spread around each hazard, in tiles. 0 = hazard tiles only.",
    options: {
      initialValue: 2,
      minValue: 0,
      maxValue: 10
    }
  },

  // Property [14]
  {
    type: PROPERTY_TYPE.COMBO,
    id: "auto_build",
    name: "Auto-Build Graph",
    desc: "Auto: build the navigation map from Solid and Jump-thru objects at startup, with no events. Off: set the map up with actions.",
    options: {
      // NOTE: items order must never change (combo values are stored by index).
      // Only initialValue may change.
      initialValue: "auto",
      items: [
        { off: "Off (manual setup)" },
        { auto: "Auto (recommended)" }
      ]
    }
  },

  // Property [15]
  {
    type: PROPERTY_TYPE.TEXT,
    id: "map_tag",
    name: "Map Tag",
    desc: "Characters with the same tag on a layout share one navigation map. Leave empty to share with everyone.",
    options: {
      initialValue: ""
    }
  },

  // Property [16]
  {
    type: PROPERTY_TYPE.CHECK,
    id: "detect_slopes",
    name: "Detect Slopes",
    desc: "Detect 45° and 22.5° slopes from collision shapes when scanning Solid and Jump-thru objects.",
    options: { initialValue: true }
  },

  // Property [17]
  {
    type: PROPERTY_TYPE.CHECK,
    id: "crowd_arrivals",
    name: "Crowd Arrivals",
    desc: "Spread characters heading to the same spot over neighbouring spots instead of stacking them.",
    options: { initialValue: false }
  },

  // Property [18]
  {
    type: PROPERTY_TYPE.FLOAT,
    id: "idle_separation",
    name: "Idle Separation",
    desc: "Personal space for idle characters, in pixels. Overlapping idle characters step apart. 0 = off.",
    options: {
      initialValue: 0,
      minValue: 0,
      maxValue: 256
    }
  },

  // Property [19]
  {
    type: PROPERTY_TYPE.FLOAT,
    id: "separation_cooldown",
    name: "Separation Cooldown",
    desc: "Seconds to rest after Idle Separation gives up in a tight crowd. 0 = never rest.",
    options: {
      initialValue: 5.0,
      minValue: 0,
      maxValue: 60
    }
  },

  // Property [20], keep LAST: the Enabled toggle conventionally sits at the
  // bottom of a behavior's properties in C3.
  {
    type: PROPERTY_TYPE.CHECK,
    id: "enabled",
    name: "Enabled",
    desc: "Whether to initially have the behavior enabled or disabled.",
    options: { initialValue: true }
  }
];
