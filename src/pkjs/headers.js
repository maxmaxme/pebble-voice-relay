/* Parses a "Name: value" per line block into a header object. */
module.exports = function parseHeaders(text) {
  var headers = {};
  (text || '').split('\n').forEach(function (line) {
    var separator = line.indexOf(':');
    if (separator < 1) {
      return;
    }
    var name = line.slice(0, separator).trim();
    if (name) {
      headers[name] = line.slice(separator + 1).trim();
    }
  });
  return headers;
};
