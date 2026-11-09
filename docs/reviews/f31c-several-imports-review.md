# Review guide: F31c, several Logseq imports

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/f31c-several-imports-review.md`.

## What this step does

Until now `/import` allowed one import until it was undone. The owner wants to import more than one folder and undo each import on its own (decision of 2026-11-09):

1. **A list.** `/import` lists every import not yet undone, newest first: the folder's name, the date, new pages and other pages and days touched, and an Undo button.
2. **Another folder.** Once an import has finished, "Choose another folder" starts a new one.
3. **One in progress at a time.** A new import is refused while another is running or being undone. Undoing one is refused while a *different* one is unfinished; in the list, its button is disabled.
4. **Continue with its own folder.** An import cut short is continued only with the folder it came from. Imports from before folder names were kept continue with any folder, as before.
5. **Same folder twice.** The report warns that the folder's lines would be added a second time.
6. **Shared pages (hand-over).** Say import A created a page and import B also uses it, by writing to it or linking to it. Undoing A removes A's lines but keeps the page, and B becomes its creator, so undoing B deletes it.

## Design

| Piece | What |
|---|---|
| Schema 6 | `imports.label`, the folder's name (nullable; older imports have none) |
| `listImports`, `getImport` | Replace `currentImport` |
| `startImport(id, label, at)` | Refused only by an import that is `running` or `undoing` |
| `startUndo` | Returns `"ok"`, `"missing"` or `"busy"`. Busy while another import is unfinished: a running import could be linking to a page this undo would delete |
| `handOverImportPage` | When the undo reaches a page this import created, the newest other import (`running` or `done`) that has it in `import_pages` is marked as creator, and the page isn't deleted. It runs before `forgetImportPage`, so a repeated undo hands it over again rather than deleting it |
| `pages` step | Now records existing pages it links to (`created = 0`), so the hand-over can see links as well as writes |
| `list` step | New. The browser reloads the list after an undo, since a hand-over changes another import's counts |

## What changed

| File | What |
|---|---|
| `agents/workspace-index.ts`, `agents/workspace.ts` | Schema 6 migration; `listImports`, `getImport`, `handOverImportPage`; `startImport` takes a label; `startUndo` returns a reason |
| `app/lib/import-lines.ts` | `ImportRecord.label`, `StartUndoResult`, `importLabel` |
| `app/routes/api.import.$step.ts` | The `list` step; `start` takes `label`; `finish` returns `{ record }`; `undo` answers 409 `busy`, and hands pages over |
| `app/lib/import-run.ts` | `ImportApi.list`; `start(label)` |
| `app/components/ImportView.tsx`, `app/routes/import.tsx` | List of imports, undo per import, folder name, same-folder warning, refusal to start a different folder while one is unfinished |
| `vitest.config.ts` | Branches floor 79 → 80 |
| Tests | Index (5 new or rewritten, plus the 5 → 6 upgrade). Route (3 new). View (rewritten: 8). Two older upgrade tests now drop the import tables, because indexes of version 2 and 3 had none |

## Deliberate breaks (each caught by a test)

- A finished import blocking another.
- Undo allowed while another import is unfinished.
- No hand-over (always delete).
- Hand-over to an import that is itself being undone.
- Existing linked pages not recorded.
- The route ignoring the hand-over.
- No same-folder warning.
- Other imports' undo buttons not disabled.
- Any folder continuing a named unfinished import.
- The list not updated from `finish`'s record.
- No reload of the list after an undo.

## Walked through (local dev server, made-up graphs only)

Two graphs, GraphA and GraphB. A has pages "Alpha Walk" and "Shared Walk" and links to "Only A Walk"; B has "Beta Walk", linking to "Shared Walk" and `#walktag`.

- **Import A, then B:** both listed, newest first. B: 2 new pages and 1 other.
- **Choose A again:** the report warns that it was imported already.
- **Undo A:** "Alpha Walk" and "Only A Walk" are gone; "Shared Walk" stays. B's row now reads 3 new pages.
- **Undo B:** it deletes 3 pages, "Shared Walk" among them. Nothing named "Walk" is left.
- **Browser console:** no errors apart from dev-server hot-reload messages, caused by my edits arriving while the tab was open.

## Worth a careful look

- **Links count as use.** A page A created that B only *links to* is kept for B. Without that, undoing A would leave B's links unresolved. The cost is that undo now visits linked existing pages, which is a no-op in each document. This costs at most 5 Durable Object calls per page, within the subrequest budget at `IMPORT_BATCH` = 6.
- **The user's own typed links don't count.** A page an import created is still deleted on undo even if the owner linked to it by hand. That was agreed on 2026-11-06 and is unchanged.
- **The same folder twice is allowed.** It is only warned about. The second import adds duplicate lines and creates no new pages (all titles exist). Its undo removes only its own lines.
- **Labels are only folder names.** Two different graphs both called "Logseq" would trigger the warning and could continue each other's unfinished import. The page says which import is unfinished, so I judged this acceptable.
