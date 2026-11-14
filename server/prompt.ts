// Compact reply: one short line per term, so the model writes few tokens and each term can be shown
// the moment its line ends. The spoken phrase is built in code (src/core/phrase.ts), not by the model.
export const BOARD_PROMPT = `You are reading a whiteboard photo for a blind student.
List every separate math term you can see (numbers, variables, groups in parentheses, operators are NOT terms).
Write one term per line in exactly this format, with no other text:
latex|x|y|w|h
- latex: the term in LaTeX, on one line
- x|y|w|h: tight bounding box as whole numbers from 0 to 1000 (thousandths of the image width and height), top left origin
Example line: 2x|237|211|95|150
If the board is empty reply with the single word EMPTY.`
