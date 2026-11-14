export const BOARD_PROMPT = `You are reading a whiteboard photo for a blind student.
List every separate math term you can see (numbers, variables, groups in parentheses, operators are NOT terms).
For each term return:
- latex: the term in LaTeX
- phrase: how a tutor would say it with its position, 2 to 6 words, e.g. "the 2x on top", "the 3 on the right side"
- box: tight bounding box, normalized 0 to 1 of image width and height, top left origin: {"x","y","w","h"}
Reply with JSON only: {"terms":[...]}. If the board is empty reply {"terms":[]}.`
