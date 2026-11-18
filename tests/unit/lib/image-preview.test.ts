// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { TextSelection } from "@tiptap/pm/state";
import { ImagePreview } from "~/lib/image-preview";
import { findImages, imageAddress } from "~/lib/images";
import { MARKDOWN_PATTERNS, findDecorations } from "~/lib/markdown-decorations";

describe("findImages", () => {
  it("finds an image with its alt text and address", () => {
    expect(findImages("- see ![a cat](https://example.com/cat.png) here")).toEqual([
      { from: 6, to: 43, alt: "a cat", src: "https://example.com/cat.png", width: null },
    ]);
  });

  it("includes Logseq's size in the image and reads its width", () => {
    const text = "- ![image.png](../assets/image_1700000000000_0.png){:height 300, :width 400}";
    expect(findImages(text)).toEqual([
      { from: 2, to: text.length, alt: "image.png", src: "../assets/image_1700000000000_0.png", width: 400 },
    ]);
  });

  it("finds images with no alt text, a title, and several on a line", () => {
    const found = findImages('![](https://a.test/1.png) and ![two](https://a.test/2.png "Two")');
    expect(found.map((i) => [i.alt, i.src])).toEqual([
      ["", "https://a.test/1.png"],
      ["two", "https://a.test/2.png"],
    ]);
  });

  it("leaves plain links and wikilinks alone", () => {
    expect(findImages("[a link](https://a.test) and [[A page]]")).toEqual([]);
  });
});

describe("imageAddress", () => {
  it("keeps web addresses", () => {
    expect(imageAddress("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(imageAddress("HTTP://example.com/a.png")).toBe("HTTP://example.com/a.png");
  });

  it("loads a Logseq graph's assets from Mistlog's store", () => {
    expect(imageAddress("../assets/image_1_0.png")).toBe("/files/assets/image_1_0.png");
    expect(imageAddress("assets/my%20photo.jpg")).toBe("/files/assets/my%20photo.jpg");
    expect(imageAddress("/assets/a b.png")).toBe("/files/assets/a%20b.png");
  });

  it("refuses anything else", () => {
    for (const src of ["javascript:alert(1)", "file:///Users/me/a.png", "../pages/a.png", "../assets/sub/a.png", "../assets/..%2Fsecret", "../assets/%zz", "data:text/html,x"]) {
      expect(imageAddress(src), src).toBeNull();
    }
  });
});

describe("markdown link styling", () => {
  it("doesn't treat an image as a link", () => {
    const link = MARKDOWN_PATTERNS.find((p) => p.name === "link")!;
    expect(findDecorations("![cat](https://a.test/c.png)", 1, link)).toEqual([]);
    expect(findDecorations("[cat](https://a.test/c)", 1, link)).not.toEqual([]);
  });
});

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
  vi.unstubAllGlobals();
});

function setup(lines: string[]) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [Document, Paragraph, Text, ImagePreview],
    content: lines.map((l) => `<p>${l}</p>`).join(""),
  });
  editors.push(editor);
  return editor;
}

/** Put the caret at the end of line `index` (0-based). */
function caretOnLine(editor: Editor, index: number) {
  let pos = 0;
  editor.state.doc.forEach((node, offset, i) => {
    if (i === index) pos = offset + node.nodeSize - 1;
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
}

describe("ImagePreview", () => {
  const CAT = "- ![a cat](https://example.com/cat.png){:width 300}";

  it("shows the picture and hides its text away from the caret", () => {
    const editor = setup([CAT, "- other line"]);
    caretOnLine(editor, 1);
    const img = editor.view.dom.querySelector(".md-image img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://example.com/cat.png");
    expect(img.alt).toBe("a cat");
    expect(img.style.width).toBe("300px");
    expect(img.referrerPolicy).toBe("no-referrer");
    const hidden = editor.view.dom.querySelector(".md-image-source");
    expect(hidden?.textContent).toBe("![a cat](https://example.com/cat.png){:width 300}");
    // The bullet stays visible
    expect(editor.view.dom.querySelector("p")!.textContent).toContain("- ");
  });

  it("shows the text to edit on the caret's line, with the picture", () => {
    const editor = setup([CAT, "- other line"]);
    caretOnLine(editor, 0);
    expect(editor.view.dom.querySelector(".md-image-source")).toBeNull();
    expect(editor.view.dom.querySelector(".md-image img")).not.toBeNull();
    caretOnLine(editor, 1);
    expect(editor.view.dom.querySelector(".md-image-source")).not.toBeNull();
  });

  it("never changes the page's text", () => {
    const editor = setup([CAT, "- other line"]);
    caretOnLine(editor, 1);
    expect(editor.state.doc.child(0).textContent).toBe(CAT);
  });

  it("leaves an image it can't show as text", () => {
    const editor = setup(["- ![x](file:///Users/me/x.png)", "- other"]);
    caretOnLine(editor, 1);
    expect(editor.view.dom.querySelector(".md-image")).toBeNull();
    expect(editor.view.dom.querySelector(".md-image-source")).toBeNull();
  });

  it("opens the picture full size on a click", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const editor = setup([CAT, "- other line"]);
    caretOnLine(editor, 1);
    (editor.view.dom.querySelector(".md-image img") as HTMLImageElement).click();
    expect(open).toHaveBeenCalledWith("https://example.com/cat.png", "_blank", "noopener,noreferrer");
    // The caret stays where it was
    expect(editor.state.selection.$head.index(0)).toBe(1);
  });

  it("says so when the picture can't be loaded", () => {
    const editor = setup(["- ![diagram](../assets/missing.png)", "- other"]);
    caretOnLine(editor, 1);
    const img = editor.view.dom.querySelector(".md-image img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/files/assets/missing.png");
    img.dispatchEvent(new Event("error"));
    expect(editor.view.dom.querySelector(".md-image-missing")?.textContent).toBe("Image not found: diagram");
  });
});
