/*
 * Word-wraps text to a pixel width. `measure` is injected so this stays
 * testable off-device (see wrap.check.mjs).
 */
export default function wrap(text, maxWidth, measure) {
  const lines = [];

  for (const paragraph of text.split("\n")) {
    let line = "";

    for (let word of paragraph.split(" ")) {
      // A single word wider than the screen (a URL, a hash) has to be cut.
      while (measure(word) > maxWidth) {
        let head = word;
        while (head.length > 1 && measure(head) > maxWidth) {
          head = head.slice(0, -1);
        }
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(head);
        word = word.slice(head.length);
      }

      const candidate = line ? line + " " + word : word;
      if (line && measure(candidate) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }

    lines.push(line);
  }

  return lines;
}
