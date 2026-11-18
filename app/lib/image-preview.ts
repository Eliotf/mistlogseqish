import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { findImages, imageAddress, type ImageRef } from "./images";

/**
 * Shows the images written in a page (`![alt](src)`, rules in images.ts).
 * The picture appears where its text is. On every line but the caret's the
 * text is hidden, as links hide their workings; on the caret's line it shows
 * so it can be edited. A click or tap on a picture opens it full size in a
 * new tab. Text whose address can't be shown (a path on someone's computer)
 * stays as text.
 */

export const imagePreviewKey = new PluginKey("imagePreview");

function caretLine(state: EditorState): number | null {
  const { $head } = state.selection;
  return $head.depth > 0 ? $head.before(1) : null;
}

function imageWidget(image: ImageRef, address: string): (view: { dom: HTMLElement }) => HTMLElement {
  return (view) => {
    const doc = view.dom.ownerDocument;
    const wrap = doc.createElement("span");
    wrap.className = "md-image";
    wrap.contentEditable = "false";
    const img = doc.createElement("img");
    img.src = address;
    img.alt = image.alt;
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.draggable = false;
    if (image.width) img.style.width = `${image.width}px`;
    img.addEventListener("error", () => {
      const missing = doc.createElement("span");
      missing.className = "md-image-missing";
      missing.textContent = `Image not found${image.alt ? `: ${image.alt}` : ""}`;
      img.replaceWith(missing);
    });
    img.addEventListener("click", (event) => {
      event.preventDefault();
      window.open(address, "_blank", "noopener,noreferrer");
    });
    wrap.appendChild(img);
    return wrap;
  };
}

/** The decorations for every image in the document: the picture, and hidden text away from the caret. */
export function imageDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];
  const caret = caretLine(state);
  state.doc.forEach((line, offset) => {
    const text = line.textContent;
    if (!text.includes("![")) return;
    const start = offset + 1;
    for (const image of findImages(text)) {
      const address = imageAddress(image.src);
      if (!address) continue;
      if (offset !== caret) {
        decorations.push(Decoration.inline(start + image.from, start + image.to, { class: "md-image-source" }));
      }
      decorations.push(
        Decoration.widget(start + image.to, imageWidget(image, address), {
          side: -1,
          key: `${address} ${image.width ?? ""} ${image.alt}`,
          // The picture is not text: clicks on it open it, and never move the caret
          stopEvent: () => true,
          ignoreSelection: true,
        }),
      );
    }
  });
  return DecorationSet.create(state.doc, decorations);
}

export const ImagePreview = Extension.create({
  name: "imagePreview",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: imagePreviewKey,
        props: { decorations: imageDecorations },
      }),
    ];
  },
});
