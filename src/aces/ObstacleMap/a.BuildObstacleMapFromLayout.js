export const config = {
  listName: "Build obstacle map from layout",
  displayText: "{my}: Build obstacle map [{0}×{1} px]",
  description: "Create an empty obstacle map grid from layout pixel dimensions. No Pathfinding behavior required. Follow with ScanSolidObjectsIntoObstacleMap and ScanJumpThruObjectsIntoObstacleMap to fill it.",
  params: [
    { id: "layoutWidth",  name: "Layout width (px)",  desc: "The layout width, in pixels.",  type: "number", initialValue: "1280" },
    { id: "layoutHeight", name: "Layout height (px)", desc: "The layout height, in pixels.", type: "number", initialValue: "720" }
  ]
};

export const expose = true;

export default function (layoutWidth, layoutHeight) {
  this.aceBuildObstacleMapFromLayout(layoutWidth, layoutHeight);
}
