export const config = {
  listName: "Build obstacle map from layout",
  displayText: "{my}: Build obstacle map [{0}×{1} px]",
  description: "Create a fresh, empty obstacle map grid of the given size, discarding the previous tiles and slopes. Follow with the Scan actions to fill it. The navigation graph rebuilds automatically. To simply rescan everything, use Regenerate obstacle map.",
  params: [
    { id: "layoutWidth",  name: "Layout width (px)",  desc: "The layout width, in pixels.",  type: "number", initialValue: "1280" },
    { id: "layoutHeight", name: "Layout height (px)", desc: "The layout height, in pixels.", type: "number", initialValue: "720" }
  ]
};

export const expose = true;

export default function (layoutWidth, layoutHeight) {
  this.aceBuildObstacleMapFromLayout(layoutWidth, layoutHeight);
}
