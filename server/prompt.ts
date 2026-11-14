// Compact reply: one short line per item, so the model writes few tokens and each item can be shown
// the moment its line ends. The spoken phrase is built in code (src/core/phrase.ts), not by the model.
export const BOARD_PROMPT = `You are reading a whiteboard photo for a blind student.
First list every separate math term you can see (numbers, variables, groups in parentheses; operators alone are NOT terms).
Then list the groups: always the numerator, denominator and whole of every fraction, both sides and the whole of every equation, and a bracket group only when its inside terms are listed separately.
Write one item per line in exactly this format, with no other text:
latex|tag|x|y|w|h
- latex: the term or group in LaTeX, on one line
- tag: lowercase, exactly one of these words
  for a term, where it lives in the math: top (in a numerator), bottom (in a denominator), power (in an exponent), left (left of an equals sign), right (right of an equals sign), bracket (inside brackets), none
  for a group: numerator, denominator, fraction, lhs, rhs, equation, group (brackets)
  a term inside a numerator is tagged top, not numerator; inside a denominator bottom, not denominator; numerator and denominator are only for the group that holds the whole top or bottom
- x|y|w|h: tight bounding box as whole numbers from 0 to 1000 (thousandths of the image width and height), top left origin; a group's box covers all its parts
Example 1: 2x(x+3) over 2x, then 3x + 5 = 20:
2x|top|237|211|95|150
(x + 3)|top|439|211|231|153
2x|bottom|439|560|96|149
2x(x + 3)|numerator|237|211|433|153
2x|denominator|439|560|96|149
\\frac{2x(x + 3)}{2x}|fraction|219|211|562|498
3x + 5|lhs|700|300|120|80
20|rhs|860|300|60|80
3x + 5 = 20|equation|700|300|220|80
Example 2: (x-3)/(x+1) = 2/x, terms first, then the groups:
x - 3|top|60|180|90|70
x + 1|bottom|60|330|90|70
2|top|420|180|40|70
x|bottom|420|330|40|70
x - 3|numerator|60|180|90|70
x + 1|denominator|60|330|90|70
\\frac{x-3}{x+1}|fraction|50|170|110|240
\\frac{2}{x}|fraction|410|170|60|240
\\frac{x-3}{x+1}|lhs|50|170|110|240
\\frac{2}{x}|rhs|410|170|60|240
\\frac{x-3}{x+1} = \\frac{2}{x}|equation|50|170|420|240
If the board is empty reply with the single word EMPTY.`
