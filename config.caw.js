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
export const description = "Smart pathfinding for platformer games. Characters automatically jump across gaps, fall between platforms, and find optimal routes through complex levels. Includes instant portals (teleporters, doors) and gradual portals (elevators, ladders, ziplines) with pause/resume support for custom animations. Features hazard avoidance, multiple path strategies, coyote jumps, ledge restriction, and multi-agent support. Works with the built-in Platform behavior — just add the behavior and go.";
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
    desc: "Show helpful debug messages in browser console (F12) to troubleshoot pathfinding issues. Disable for better performance in final game.",
    options: { initialValue: true }
  },

  // Property [1]
  {
    type: PROPERTY_TYPE.INTEGER,
    id: "cell_size",
    name: "Tile Size",
    desc: "Size of each grid tile in pixels. MUST match your tilemap's tile size / Pathfinding behavior's Cell Size — a mismatch misaligns the graph and characters walk into walls. Set to 0 to auto-detect it (reads the Pathfinding behavior's Cell Size, or the solid tilemap's tile size). Smaller = more precise paths but slower performance.",
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
    desc: "Maximum pathfinding effort before giving up. Higher = finds paths in larger levels but may cause lag. Lower = faster but may fail on complex paths.",
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
    desc: "Maximum fall distance in pixels. 0 = auto-detect from Platform behavior. -1 = unlimited (any fall). Positive value = custom max in pixels.",
    options: { initialValue: 0 }
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

  // Property [6]
  {
    type: PROPERTY_TYPE.CHECK,
    id: "smooth_paths",
    name: "Smooth Paths",
    desc: "Remove unnecessary waypoints for more natural movement. AI will take direct routes when possible instead of zigzagging.",
    options: { initialValue: true }
  },

  // Property [7]
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

  // Property [8]
  {
    type: PROPERTY_TYPE.FLOAT,
    id: "coyote_time",
    name: "Coyote Time",
    desc: "Seconds after walking off a ledge where a jump can still be executed. Allows AI to walk off edges and jump mid-air for greater reach, making slightly out-of-range platforms reachable. Important: only works when 'Ledge Restriction' is disabled — if Ledge Restriction is enabled, characters won't walk off edges, so coyote jumps can never execute and the connections will go unused. 0 = disabled.",
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
    desc: "When the AI is following a path and needs to jump or fall to another platform, it will slow down and carefully position itself on the tile before launching. This prevents characters from overshooting edges and missing jumps — like a chase enemy flying off a ledge instead of jumping across, or an escort NPC slipping off a narrow bridge mid-jump. Note: this only affects movement DURING pathfinding (jumps and falls that are part of the path). To stop characters from walking off edges entirely, use 'Ledge Restriction' instead. Recommended ON for most games.",
    options: { initialValue: true }
  },

  // Property [10]
  {
    type: PROPERTY_TYPE.CHECK,
    id: "ledge_restriction",
    name: "Ledge Restriction",
    desc: "Prevents AI characters from walking off platform edges when they have no reason to leave. Useful for patrol guards that should stay on their platform, or NPCs that shouldn't wander off rooftops. Note: this only stops characters from casually walking off edges — if the AI's path requires a jump or fall to reach its goal, it will still leave the platform. When enabled, 'Coyote Time' has no effect since characters won't walk off edges to trigger it. When disabled, characters can slide off edges freely, which also enables wall-adjacent jumps (walking to the platform edge to clear a wall before jumping). To make jumps and falls more precise, use 'Strict Jump Positioning' instead.",
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
  },

  // Property [14]
  {
    type: PROPERTY_TYPE.COMBO,
    id: "auto_build",
    name: "Auto-Build Graph",
    desc: "Zero-event startup: automatically build the obstacle map and navigation graph on startup, no events needed. Auto (default): use the Pathfinding behavior's map if one is attached to this object, otherwise scan all objects with Solid/Jump-thru behaviors. Explicit map-setup actions in 'On start of layout' always take precedence. From Pathfinding: always wait for the Pathfinding behavior's map. From Solids: always scan Solid/Jump-thru objects. Off: set the map up yourself with actions (still picks up an attached Pathfinding behavior's map automatically).",
    options: {
      // NOTE: items order must never change (combo values are stored by index).
      // Only initialValue may change.
      initialValue: "auto",
      items: [
        { off: "Off (manual setup)" },
        { auto: "Auto (recommended)" },
        { pathfinding: "From Pathfinding behavior" },
        { solids: "From Solid/Jump-thru objects" }
      ]
    }
  },

  // Property [15]
  {
    type: PROPERTY_TYPE.TEXT,
    id: "map_tag",
    name: "Map Tag",
    desc: "Instances with the same map tag on a layout share one navigation map and graph. Leave empty to share with everyone (recommended). Give special characters their own tag (e.g. 'ghost' for wall-phasing enemies, 'flyer' for airborne ones), then set up that tag's obstacle map, portals, and hazards on an instance carrying that tag. Each tag builds and stores its own map, so use few tags.",
    options: {
      initialValue: ""
    }
  },

  // Property [16]
  {
    type: PROPERTY_TYPE.CHECK,
    id: "detect_slopes",
    name: "Detect Slopes",
    desc: "During solid scanning (including Auto-Build), probe each partially-solid tile's collision shape and automatically register 45° and 22.5° slope surfaces as slopes — no tile ID lists needed. Tiles whose shape doesn't match a supported slope angle stay solid, so this is safe to leave on. Requires tiles/sprites to have actual sloped collision polygons. Turn off to register slopes yourself with the slope actions only.",
    options: { initialValue: true }
  },

  // Property [17] — keep LAST: the Enabled toggle conventionally sits at the
  // bottom of a behavior's properties in C3.
  {
    type: PROPERTY_TYPE.CHECK,
    id: "enabled",
    name: "Enabled",
    desc: "Whether the behavior starts active. While disabled, the character stops following paths and Find path actions are ignored; the current path, graph, and settings are kept and everything resumes when re-enabled. Toggle at runtime with the 'Set enabled' action.",
    options: { initialValue: true }
  }
];
