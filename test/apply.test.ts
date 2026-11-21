import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyAnchorEdits, countOccurrences, previewDiff } from "../src/apply.ts";

describe("countOccurrences", () => {
  it("counts non-overlapping occurrences", () => {
    assert.equal(countOccurrences("aaa", "aa"), 1);
    assert.equal(countOccurrences("aXaXa", "a"), 3);
    assert.equal(countOccurrences("hi", ""), 0);
  });
});

describe("applyAnchorEdits", () => {
  const base = 'line1\nassert!(patch_mesh(&sphere, "kind", "nonsense").is_none());\nline3\n';

  it("inserts after a unique anchor", () => {
    const anchor = 'assert!(patch_mesh(&sphere, "kind", "nonsense").is_none());\n';
    const { content, counts } = applyAnchorEdits(base, [{ anchor, text: "// added\n" }]);
    assert.deepEqual(counts, [1]);
    assert.ok(content.includes(anchor + "// added\n"));
  });

  it("throws on count mismatch and applies nothing", () => {
    assert.throws(() =>
      applyAnchorEdits(base, [{ anchor: "missing", text: "x" }]),
    );
    assert.throws(() =>
      applyAnchorEdits("a a a", [{ anchor: "a", text: "b", expectCount: 2 }]),
    );
  });

  it("replaces in all occurrences", () => {
    const { content } = applyAnchorEdits("v=1; v=1", [
      { anchor: "v=1", text: "v=2", mode: "replace", expectCount: 2 },
    ]);
    assert.equal(content, "v=2; v=2");
  });

  it("validates all edits before applying any (atomic)", () => {
    const edits = [
      { anchor: "line1\n", text: "X" },
      { anchor: "missing", text: "Y" },
    ];
    assert.throws(() => applyAnchorEdits(base, edits));
  });

  it("reproduces the morph mui_bridge scenario", () => {
    const anchor = '        assert!(patch_mesh(&sphere, "kind", "nonsense").is_none());\n';
    const src = `fn t() {\n    let sphere = 1;\n${anchor}}\n`;
    const add = `        // UV comment\n`;
    const { content } = applyAnchorEdits(src, [{ anchor, text: add }]);
    assert.ok(content.includes(anchor + add));
  });
});

describe("applyAnchorEdits: robustness", () => {
  it("rejects an edit whose anchor was created by an earlier edit", () => {
    // edit 0 inserts a second "marker"; edit 1 expected exactly one
    assert.throws(
      () =>
        applyAnchorEdits("marker\n", [
          { anchor: "marker", text: " marker" },
          { anchor: "marker", text: "!" },
        ]),
      /after earlier edits/,
    );
  });

  it("rejects an edit whose anchor an earlier edit replaced", () => {
    assert.throws(
      () =>
        applyAnchorEdits("foo\n", [
          { anchor: "foo", text: "bar", mode: "replace" },
          { anchor: "foo", text: "x" },
        ]),
      /after earlier edits/,
    );
  });

  it("matches multi-line anchors in CRLF files and keeps CRLF", () => {
    const crlf = "a\r\nb\r\nc\r\n";
    const { content } = applyAnchorEdits(crlf, [{ anchor: "a\nb\n", text: "X\n" }]);
    assert.equal(content, "a\r\nb\r\nX\r\nc\r\n");
  });

  it("reports an empty anchor as such", () => {
    assert.throws(() => applyAnchorEdits("abc", [{ anchor: "", text: "x" }]), /empty anchor/);
  });
});

describe("previewDiff", () => {
  it("shows only the changed block", () => {
    const d = previewDiff("a\nb\nc\n", "a\nB\nc\n");
    assert.match(d, /@@ line 2 @@/);
    assert.match(d, /-b\n\+B/);
  });

  it("caps long output", () => {
    const d = previewDiff("", "x\n".repeat(100), 5);
    assert.match(d, /more lines/);
  });
});
