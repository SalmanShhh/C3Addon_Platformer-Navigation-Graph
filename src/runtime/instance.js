export default function(parentClass) {
  return class PlatformerPathfindingInstance extends parentClass {
    constructor() {
      super();

      console.log("═══════════════════════════════════");
      console.log("[Phase 0] Initializing...");

      // Read properties (NO group headers to skip!)
      const props = this._getInitProperties();
      this.enableDebug = props[0];    // First property
      this.cellSize = props[1];       // Second property

      // Initialize state
      this.navGraph = new Map();
      this.graphGenerated = false;

      console.log("[Phase 0] ✅ Ready!", {
        debug: this.enableDebug,
        cellSize: this.cellSize
      });
      console.log("═══════════════════════════════════");
    }

    _release() {
      super._release();
      this.navGraph.clear();
    }

    _tick() {
      // Empty for now
    }

    _saveToJson() {
      return { version: 1 };
    }

    _loadFromJson(o) {}

    // Helpers
    log(message, data) {
      if (this.enableDebug) {
        console.log(`[Pathfinding] ${message}`, data || '');
      }
    }
  };
}
