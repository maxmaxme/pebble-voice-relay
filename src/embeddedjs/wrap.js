/*
 * Word-wraps text to a pixel width, returning a flat Uint16Array of
 * [start, end] index pairs rather than the substrings themselves. Line i is
 * `text.slice(spans[2 * i], spans[2 * i + 1])`.
 *
 * Indices, because a long reply is what runs the JS heap out on the watch:
 * every element of a normal array costs a slot, and `split(" ")` alone holds
 * over a thousand of them alive at once for an 8K reply — several times more
 * than the wrapped lines it produces. A Uint16Array lives in one chunk and
 * costs a single slot no matter how many lines there are, so the caller can
 * cut only the handful of lines it is about to draw.
 *
 * Text past 65535 characters is dropped rather than wrapped: the spans are
 * Uint16, and indices beyond that would wrap around and quietly point at the
 * wrong characters. The watch inbox caps a reply far below the limit.
 *
 * `measure` is injected so this stays testable off-device (see tools/check.mjs).
 */
const MAX_INDEX = 65535;

export default function wrap(text, maxWidth, measure) {
  const length = Math.min(text.length, MAX_INDEX);
  let spans = new Uint16Array(128);
  let count = 0;

  function push(start, end) {
    if (2 * count === spans.length) {
      const grown = new Uint16Array(2 * spans.length);
      grown.set(spans);
      spans = grown;
    }
    spans[2 * count] = start;
    spans[2 * count + 1] = end;
    count++;
  }

  function fits(start, end) {
    return measure(text.slice(start, end)) <= maxWidth;
  }

  let paragraph = 0;
  while (paragraph <= length) {
    let end = text.indexOf("\n", paragraph);
    if (end < 0 || end > length) {
      end = length;
    }

    // An empty line is start === end, which still has to be pushed so blank
    // lines in the reply survive the wrap.
    let lineStart = paragraph;
    let lineEnd = paragraph;
    let word = paragraph;

    while (word <= end) {
      let wordEnd = text.indexOf(" ", word);
      if (wordEnd < 0 || wordEnd > end) {
        wordEnd = end;
      }

      // A single word wider than the screen (a URL, a hash) has to be cut.
      while (word < wordEnd && !fits(word, wordEnd)) {
        let head = wordEnd;
        while (head - word > 1 && !fits(word, head)) {
          head--;
        }
        if (lineEnd > lineStart) {
          push(lineStart, lineEnd);
        }
        push(word, head);
        word = head;
        lineStart = word;
        lineEnd = word;
      }

      if (lineEnd === lineStart) {
        lineStart = word;
        lineEnd = wordEnd;
      } else if (fits(lineStart, wordEnd)) {
        // The separating space is already between the two, so extending the
        // line's end over it is the whole join.
        lineEnd = wordEnd;
      } else {
        push(lineStart, lineEnd);
        lineStart = word;
        lineEnd = wordEnd;
      }

      word = wordEnd + 1;
    }

    push(lineStart, lineEnd);
    paragraph = end + 1;
  }

  return spans.subarray(0, 2 * count);
}
