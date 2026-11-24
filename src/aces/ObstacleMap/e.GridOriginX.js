export const config = {
  returnType: "number",
  description: "The world X co-ordinate of grid tile 0, in pixels. 0 unless the obstacle map covers content left of the layout or grew to include it. World X = GridOriginX + tile X * GridTileSize.",
  params: []
};

export const expose = true;

export default function () {
  return this.gridOriginX || 0;
}
