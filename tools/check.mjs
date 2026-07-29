/* Self-checks for the two pieces of real logic. Run: node tools/check.mjs */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import wrap from "../src/embeddedjs/wrap.js";

const require = createRequire(import.meta.url);
const parseHeaders = require("../src/pkjs/headers.js");

// One char per pixel keeps the expected output obvious.
const measure = (s) => s.length;

assert.deepEqual(wrap("hello", 10, measure), ["hello"]);
assert.deepEqual(wrap("hello there world", 11, measure), ["hello there", "world"]);
assert.deepEqual(wrap("a\nb", 10, measure), ["a", "b"]);
assert.deepEqual(wrap("aaaaaaaa", 3, measure), ["aaa", "aaa", "aa"]);
assert.deepEqual(wrap("hi aaaaaa", 3, measure), ["hi", "aaa", "aaa"]);
assert.deepEqual(wrap("", 10, measure), [""]);

assert.deepEqual(parseHeaders("Authorization: Bearer x"), { Authorization: "Bearer x" });
assert.deepEqual(parseHeaders("A: 1\nB: 2"), { A: "1", B: "2" });
assert.deepEqual(parseHeaders("A: http://x:8080/y"), { A: "http://x:8080/y" });
assert.deepEqual(parseHeaders("junk\n\n: novalue\nA: 1"), { A: "1" });
assert.deepEqual(parseHeaders(undefined), {});

console.log("ok");
