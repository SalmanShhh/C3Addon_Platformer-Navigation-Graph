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
export const description = "AI pathfinding for platformers: lets characters jump, fall, and navigate complex levels. Easy presets for beginners, deep customization for advanced users. Supports auto or manual control, hazards, portals, and integrates with Platform behavior.";
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
    name: "Tile Size",
    desc: "Size of each grid tile in pixels. MUST match the Cell Size in your Pathfinding behavior! Smaller = more precise paths but slower performance.",
    options: {
      initialValue: 32,
      minValue: 8,
      maxValue: 128
    }
  },
  
  // Property [2]
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

  // Property [3]
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

  // Property [4]
  {
    type: PROPERTY_TYPE.CHECK,
    id: "auto_control",
    name: "Auto-Control Movement",
    desc: "When enabled, AI automatically controls the character (moves left/right, jumps). When disabled, you handle movement yourself using the path data.",
    options: { initialValue: true }
  },

  // Property [5]
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

  // Property [6]
  {
    type: PROPERTY_TYPE.COMBO,
    id: "path_strategy",
    name: "Path Strategy",
    desc: "How the AI picks the best route when multiple paths exist. Balanced: weighs distance and difficulty equally, good for most platformers and adventure games. Shortest Distance: always takes the fastest route even with risky jumps, ideal for speedrunner games and time trials. Safest Route: avoids jumps and falls when possible, great for stealth games, escort missions, or fragile NPCs. Simplest Path: fewest waypoints for predictable movement, best for simple enemies and tower defense creeps.",
    options: {
      initialValue: "balanced",
      items: [
        { balanced: "Balanced (recommended for most games)" },
        { shortest: "Shortest Distance (speedrunners, time trials)" },
        { safest: "Safest Route (stealth, escort missions)" },
        { simplest: "Simplest Path (simple enemies, predictable AI)" }
      ]
    }
  },

  // Property [7]
  {
    type: PROPERTY_TYPE.CHECK,
    id: "smooth_paths",
    name: "Smooth Paths",
    desc: "Remove unnecessary waypoints for more natural movement. AI will take direct routes when possible instead of zigzagging.",
    options: { initialValue: true }
  },

  // Property [8]
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

  // Property [9]
  {
    type: PROPERTY_TYPE.FLOAT,
    id: "coyote_time",
    name: "Coyote Time",
    desc: "Seconds after walking off a ledge where a jump can still be executed. Allows AI to walk off edges and jump mid-air for greater reach. 0 = disabled.",
    options: {
      initialValue: 0,
      minValue: 0,
      maxValue: 1.0
    }
  },

  // Property [10]
  {
    type: PROPERTY_TYPE.CHECK,
    id: "ledge_restriction",
    name: "Ledge Restriction",
    desc: "When enabled, AI characters stop at platform edges instead of walking off. Useful for patrol guards in stealth games or NPCs that should stay on their platform. Only affects auto-control movement, not pathfinding.",
    options: { initialValue: false }
  },

  // Property [11]
  {
    type: PROPERTY_TYPE.FLOAT,
    id: "ledge_leniency",
    name: "Ledge Leniency",
    desc: "How many pixels past a platform edge the AI is allowed to walk before stopping (0 = strict stop at edge). Increase for more natural-looking movement near edges. Only used when Ledge Restriction is enabled.",
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
    desc: "How many tiles the character can deviate from its path before automatically recalculating. Useful when the character gets knocked off course. 0 = disabled.",
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
    desc: "Tile radius for hazard cost falloff buffer zone. Nearby tiles within this radius of a hazard get cost penalties. 0 = no buffer, only exact hazard tiles affected.",
    options: {
      initialValue: 2,
      minValue: 0,
      maxValue: 10
    }
  }
];
