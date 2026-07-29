/*
 * Trims text to fit a byte budget, since the watch inbox is measured in bytes
 * while JS strings are measured in UTF-16 code units. Cuts on a character
 * boundary and never splits a surrogate pair.
 */
function utf8Length(code) {
  if (code < 0x80) {
    return 1;
  }
  if (code < 0x800) {
    return 2;
  }
  return 3;
}

module.exports = function trim(text, maxBytes, suffix) {
  var ellipsis = suffix === undefined ? '...' : suffix;
  var bytes = 0;
  var i = 0;

  while (i < text.length) {
    var code = text.charCodeAt(i);
    var isPair = code >= 0xd800 && code <= 0xdbff && i + 1 < text.length;
    var size = isPair ? 4 : utf8Length(code);

    if (bytes + size > maxBytes) {
      return text.slice(0, i) + ellipsis;
    }

    bytes += size;
    i += isPair ? 2 : 1;
  }

  return text;
};
