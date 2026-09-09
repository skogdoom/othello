/** Every colour and dimension in the board rendering lives here. */
export const THEME = {
  boardSize: 800,
  margin: 24,

  felt: 0x1e7d4f,
  feltEdge: 0x14603b,
  gridLine: 0x14603b,
  gridWidth: 2,

  black: 0x14171a,
  white: 0xf4f2ec,
  discEdge: 0x000000,
  discEdgeAlpha: 0.18,
  discRadius: 0.42, // fraction of a cell

  hint: 0xf4f2ec,
  hintAlpha: 0.3,
  hintRadius: 0.1,

  ring: 0xf0c419,
  ringWidth: 3,
  ringRadius: 0.46,
} as const;

export const CELL = (THEME.boardSize - THEME.margin * 2) / 8;
