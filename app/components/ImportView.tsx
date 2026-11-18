import { useState, useSyncExternalStore, type ChangeEvent } from "react";
import { Link } from "react-router";
import { convertGraph, summarise, titlesToResolve, type ImportFile, type ImportPlan, type ImportSummary, type ExistingInMistlog } from "~/lib/logseq-import";
import { importLabel, type ImportRecord } from "~/lib/import-lines";
import { importApi, runImport, runUndo, type ImportApi, type ImportOutcome, type ImportProgress } from "~/lib/import-run";
import { graphImageName } from "~/lib/images";
import { sendImages, sendImage, type GraphImage, type SendImage, type SendOutcome } from "~/lib/asset-upload";

type Stage =
  | { kind: "idle" }
  | { kind: "reading"; done: number; total: number }
  | { kind: "checking" }
  | { kind: "ready"; plan: ImportPlan; summary: ImportSummary; label: string | null; images: GraphImage[] }
  | { kind: "importing"; progress: ImportProgress | null }
  | { kind: "imported"; outcome: ImportOutcome }
  | { kind: "confirm-undo"; record: ImportRecord }
  | { kind: "undoing"; left: number | null }
  | { kind: "undone"; record: ImportRecord }
  | { kind: "failed"; message: string };

export async function checkExisting(plan: ImportPlan): Promise<ExistingInMistlog> {
  const titles = titlesToResolve(plan);
  const dates = plan.pages.flatMap((p) => (p.date ? [p.date] : []));
  const res = await fetch("/api/import/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titles, dates }) });
  if (!res.ok) throw new Error(`check: ${res.status}`);
  return (await res.json()) as ExistingInMistlog;
}

/** Only Markdown and Org files need their text; the rest are counted or skipped. */
const NEEDS_TEXT = /\.(md|org)$/i;

const n = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

interface ImportViewProps {
  /** The imports not yet undone, newest first (from the route's loader). */
  imports: ImportRecord[];
  check?: typeof checkExisting;
  api?: ImportApi;
  wait?: (ms: number) => Promise<unknown>;
  send?: SendImage;
}

/** Sending a folder's images: not started, under way, or finished. */
type ImageSend = { kind: "sending"; done: number } | { kind: "sent"; outcome: SendOutcome } | null;

/** The folder's name, from the path the browser gives each file inside it. */
export function folderName(files: File[]): string | null {
  const path = files[0]?.webkitRelativePath ?? "";
  return path.includes("/") ? importLabel(path.split("/")[0]) : null;
}

const nameOf = (record: ImportRecord) => `“${record.label ?? "Logseq graph"}”`;

/** Put a record first in the list, replacing its older copy. */
const withRecord = (imports: ImportRecord[], record: ImportRecord) => [record, ...imports.filter((i) => i.importId !== record.importId)];

/**
 * Import from Logseq (PRD F31). Pick a graph folder; its files are read and
 * converted in this browser (logseq-import.ts), and only titles and dates
 * are sent to see what already exists. The report says what an import would
 * do; nothing is written until Import. Several folders can be imported, one
 * at a time; each is listed and can be undone (exactly the lines it added,
 * and the pages it created that no other import uses). One cut short is
 * continued by choosing its folder again.
 */
export default function ImportView({ imports: initial, check = checkExisting, api = importApi, wait, send = sendImage }: ImportViewProps) {
  const [imports, setImports] = useState(initial);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [imageSend, setImageSend] = useState<ImageSend>(null);
  const busy = stage.kind === "importing" || stage.kind === "undoing" || stage.kind === "reading" || stage.kind === "checking" || imageSend?.kind === "sending";
  // Running or being undone: until it is finished or undone, no other import starts or is undone
  const unfinished = imports.find((i) => i.state !== "done") ?? null;
  const canPick = !busy && stage.kind !== "confirm-undo" && unfinished?.state !== "undoing";

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const list = [...(event.target.files ?? [])];
    if (!list.length) return;
    setStage({ kind: "reading", done: 0, total: list.length });
    setImageSend(null);
    try {
      const files: ImportFile[] = [];
      const images: GraphImage[] = [];
      for (const [i, file] of list.entries()) {
        const path = file.webkitRelativePath || file.name;
        files.push({ path, text: NEEDS_TEXT.test(path) ? await file.text() : "" });
        const imageName = graphImageName(path);
        if (imageName) images.push({ name: imageName, file });
        if (i % 50 === 0) setStage({ kind: "reading", done: i, total: list.length });
      }
      const plan = convertGraph(files);
      setStage({ kind: "checking" });
      const existing = await check(plan);
      setStage({ kind: "ready", plan, summary: summarise(plan, existing), label: folderName(list), images });
    } catch (err) {
      console.error("Import dry run failed", err);
      setStage({ kind: "failed", message: "Couldn't read the folder or reach Mistlog. Try again in a moment." });
    }
  };

  const start = async (plan: ImportPlan, label: string | null, continuing: ImportRecord | null) => {
    setStage({ kind: "importing", progress: null });
    let importId = continuing?.importId ?? null;
    try {
      if (!importId) {
        const started = await api.start(label);
        if (!started.ok) {
          setImports((list) => withRecord(list, started.current));
          setStage({ kind: "failed", message: `The import of ${nameOf(started.current)} isn't finished. Continue or undo it first.` });
          return;
        }
        importId = started.importId;
        setImports((list) => withRecord(list, { importId: importId!, label, state: "running", startedAt: Date.now(), finishedAt: null, pages: 0, created: 0 }));
      }
      const outcome = await runImport(importId, plan, (progress) => setStage({ kind: "importing", progress }), { api, wait });
      const id = importId;
      setImports((list) => {
        const record = outcome.record ?? list.find((i) => i.importId === id);
        return record ? withRecord(list, { ...record, state: "done", finishedAt: record.finishedAt ?? Date.now() }) : list;
      });
      setStage({ kind: "imported", outcome });
    } catch (err) {
      console.error("Import failed", err);
      setStage({ kind: "failed", message: "The import stopped before it finished. Choose the folder again to continue it, or undo it." });
    }
  };

  const sendFolderImages = async (images: GraphImage[]) => {
    setImageSend({ kind: "sending", done: 0 });
    const outcome = await sendImages(images, (done) => setImageSend({ kind: "sending", done }), send);
    setImageSend({ kind: "sent", outcome });
  };

  const undo = async (record: ImportRecord) => {
    setStage({ kind: "undoing", left: null });
    try {
      await runUndo(record.importId, (left) => setStage({ kind: "undoing", left }), { api, wait });
      setImports((list) => list.filter((i) => i.importId !== record.importId));
      setStage({ kind: "undone", record });
      // Pages another import took over change its counts: fetch them afresh
      api.list().then(setImports, (err: unknown) => console.error("Reloading the imports failed", err));
    } catch (err) {
      console.error("Undoing the import failed", err);
      setImports((list) => list.map((i) => (i.importId === record.importId ? { ...i, state: "undoing" } : i)));
      setStage({ kind: "failed", message: "Undoing stopped before it finished. Try again in a moment." });
    }
  };

  return (
    <div className="mx-6 mb-10 mt-8 max-w-[65ch]">
      <h1 className="text-[1.75rem] font-semibold leading-tight text-ink">Import from Logseq</h1>
      <p className="mt-2 text-sm text-muted">
        Choose your Logseq graph's folder (the one with <code>pages</code> and <code>journals</code> in it). It is read in this browser; only page titles and dates are sent, to see
        what Mistlog has already. You see what an import would do before anything is written.
      </p>
      {imports.length > 0 && !busy && <ImportList imports={imports} unfinished={unfinished} onUndo={(record) => setStage({ kind: "confirm-undo", record })} />}
      {stage.kind === "confirm-undo" && <ConfirmUndo record={stage.record} onConfirm={() => void undo(stage.record)} onCancel={() => setStage({ kind: "idle" })} />}
      {canPick && (
        <label className="mt-4 inline-block cursor-pointer border border-border px-3 py-1.5 text-sm uppercase tracking-wider hover:bg-border focus-within:outline focus-within:outline-2">
          {imports.length > 0 ? "Choose another folder" : "Choose folder"}
          <input type="file" multiple className="sr-only" onChange={(e) => void pick(e)} {...{ webkitdirectory: "", directory: "" }} />
        </label>
      )}
      {stage.kind === "reading" && (
        <p role="status" className="mt-4 text-sm text-muted">
          Reading {stage.done} of {stage.total} files…
        </p>
      )}
      {stage.kind === "checking" && (
        <p role="status" className="mt-4 text-sm text-muted">
          Checking what Mistlog has already…
        </p>
      )}
      {stage.kind === "importing" && (
        <p role="status" className="mt-4 text-sm text-muted">
          {!stage.progress
            ? "Starting the import…"
            : stage.progress.phase === "pages"
              ? `Finding and creating pages: ${stage.progress.done.toLocaleString()} of ${stage.progress.total.toLocaleString()}…`
              : `Writing pages and days: ${stage.progress.done.toLocaleString()} of ${stage.progress.total.toLocaleString()}…`}{" "}
          Keep this tab open.
        </p>
      )}
      {stage.kind === "undoing" && (
        <p role="status" className="mt-4 text-sm text-muted">
          Undoing the import{stage.left !== null ? `: ${n(stage.left, "page")} left` : ""}… Keep this tab open.
        </p>
      )}
      {stage.kind === "undone" && (
        <p role="status" className="mt-4 text-sm text-ink">
          The import of {nameOf(stage.record)} is undone.
        </p>
      )}
      {stage.kind === "failed" && (
        <p role="alert" className="mt-4 text-sm text-coral">
          {stage.message}
        </p>
      )}
      {stage.kind === "ready" && (
        <>
          <Report plan={stage.plan} summary={stage.summary} label={stage.label} imports={imports} unfinished={unfinished} onImport={(continuing) => void start(stage.plan, stage.label, continuing)} />
          <Images images={stage.images} others={stage.plan.stats.assets - stage.images.length} state={imageSend} onSend={() => void sendFolderImages(stage.images)} />
        </>
      )}
      {stage.kind === "imported" && <Imported outcome={stage.outcome} />}
    </div>
  );
}

const noSubscription = () => () => {};

/** A date in the browser's own locale and time zone; blank on the server, so hydration matches. */
function useBrowserDate(at: number): string {
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  return inBrowser ? ` on ${new Date(at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}` : "";
}

function ImportList({ imports, unfinished, onUndo }: { imports: ImportRecord[]; unfinished: ImportRecord | null; onUndo: (record: ImportRecord) => void }) {
  return (
    <section aria-label="Your imports" className="mt-4 text-sm">
      <h2 className="text-sm uppercase tracking-wider text-muted">Your imports</h2>
      <ul className="mt-2 divide-y divide-border border border-border">
        {imports.map((record) => (
          <ImportRow key={record.importId} record={record} blocked={unfinished !== null && unfinished.importId !== record.importId} onUndo={() => onUndo(record)} />
        ))}
      </ul>
      {unfinished && imports.length > 1 && (
        <p className="mt-2 text-xs text-muted">Until {nameOf(unfinished)} is finished or undone, the others can't be undone.</p>
      )}
    </section>
  );
}

function ImportRow({ record, blocked, onUndo }: { record: ImportRecord; blocked: boolean; onUndo: () => void }) {
  const when = useBrowserDate(record.finishedAt ?? record.startedAt);
  const others = record.pages - record.created;
  const message =
    record.state === "done"
      ? `Imported${when}: ${n(record.created, "new page")} and ${n(others, "other page or day", "other pages and days")}.`
      : record.state === "running"
        ? `Started${when}, didn't finish. Choose its folder again to continue it, or undo it.`
        : "Undoing it didn't finish.";
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3">
      <p className="text-ink">
        <span className="font-semibold">{nameOf(record)}</span> {message}
      </p>
      <button type="button" onClick={onUndo} disabled={blocked} aria-label={`${record.state === "undoing" ? "Continue undoing" : "Undo"} the import of ${nameOf(record)}`} className="text-coral underline disabled:text-muted disabled:no-underline">
        {record.state === "undoing" ? "Continue undoing" : "Undo"}
      </button>
    </li>
  );
}

function ConfirmUndo({ record, onConfirm, onCancel }: { record: ImportRecord; onConfirm: () => void; onCancel: () => void }) {
  return (
    <section aria-label="Undo the import" className="mt-4 border border-coral p-3 text-sm">
      <p className="text-ink">
        Undo the import of {nameOf(record)}? It removes every line it added, even ones you have edited since, and deletes the {n(record.created, "page")} it created (with anything
        written on them since), except pages another import uses too. Lines you wrote yourself on other pages and days stay.
      </p>
      <div className="mt-2 flex gap-4">
        <button type="button" onClick={onConfirm} className="text-coral underline">
          Undo the import
        </button>
        <button type="button" onClick={onCancel} className="text-muted underline">
          Cancel
        </button>
      </div>
    </section>
  );
}

function Imported({ outcome }: { outcome: ImportOutcome }) {
  return (
    <section aria-label="Import finished" className="mt-6 text-sm">
      <p role="status" className="text-ink">
        Imported: {n(outcome.written, "page or day", "pages and days")} written.
      </p>
      {outcome.failed.length > 0 && (
        <Details title={`${n(outcome.failed.length, "page")} couldn't be written`}>
          {outcome.failed.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </Details>
      )}
      <div className="mt-3 flex flex-wrap gap-4">
        <Link to="/" className="underline">
          Go to your journal
        </Link>
        <Link to="/pages" className="underline">
          All pages
        </Link>
      </div>
    </section>
  );
}

interface ReportProps {
  plan: ImportPlan;
  summary: ImportSummary;
  /** The picked folder's name. */
  label: string | null;
  imports: ImportRecord[];
  unfinished: ImportRecord | null;
  /** Import, continuing the given unfinished import or starting a new one (null). */
  onImport: (continuing: ImportRecord | null) => void;
}

function Report({ plan, summary, label, imports, unfinished, onImport }: ReportProps) {
  const { stats } = plan;
  // An unfinished import is continued with its own folder (older imports have no name, so any folder)
  const continuing = unfinished?.state === "running" && (unfinished.label === null || unfinished.label === label) ? unfinished : null;
  const blockedBy = unfinished && !continuing ? unfinished : null;
  const sameFolder = !continuing && label !== null ? imports.find((i) => i.state === "done" && i.label === label) : undefined;
  return (
    <section aria-label="What an import would do" className="mt-6">
      <h2 className="text-sm uppercase tracking-wider text-muted">What an import would do</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-ink">
        <li>
          {n(summary.newPages, "new page")}
          {summary.addedToPages > 0 && `; ${n(summary.addedToPages, "page")} you have already get the imported lines added below`}
        </li>
        <li>
          {n(summary.newDays, "new journal day")}
          {summary.addedToDays > 0 && `; ${n(summary.addedToDays, "day")} you have already get the imported lines added below`}
        </li>
        <li>{n(summary.emptyPages, "empty page")} for links to pages that aren't in your graph (as typing a link does)</li>
        <li>
          {n(stats.links, "link")} and {n(stats.tags, "tag")}, linked to their pages
        </li>
        <li>
          {n(stats.blockIds, "block ID")} and {n(stats.folds, "fold")} kept; {n(stats.continuationLines, "line")} of multi-line blocks kept under their bullets
        </li>
        <li>{n(stats.lines, "line")} in all</li>
      </ul>
      {plan.renamed.length > 0 && (
        <Details title={`${n(plan.renamed.length, "page")} renamed (titles can't contain [[ or ]])`}>
          {plan.renamed.map((r) => (
            <li key={r.from}>
              “{r.from}” becomes “{r.to}”
            </li>
          ))}
        </Details>
      )}
      {plan.combined.length > 0 && (
        <Details title={`${n(plan.combined.length, "page")} made from more than one file`}>
          {plan.combined.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </Details>
      )}
      {plan.skipped.length > 0 && (
        <Details title={`${n(plan.skipped.length, "file")} skipped`}>
          {plan.skipped.map((s) => (
            <li key={s.path}>
              {s.path}: {s.reason}
            </li>
          ))}
        </Details>
      )}
      {sameFolder && (
        <p role="note" className="mt-4 text-sm text-coral">
          You have imported a folder called {nameOf(sameFolder)} already. Importing it again adds its lines a second time; undo the earlier import first if you want them once.
        </p>
      )}
      {blockedBy ? (
        <p role="alert" className="mt-6 text-sm text-coral">
          The import of {nameOf(blockedBy)} isn't finished. Choose that folder to continue it, or undo it, before importing another.
        </p>
      ) : (
        <>
          <button type="button" onClick={() => onImport(continuing)} className="mt-6 border border-ink px-3 py-1.5 text-sm uppercase tracking-wider text-ink hover:bg-border">
            {continuing ? "Continue import" : "Import"}
          </button>
          <p className="mt-2 text-xs text-muted">You can undo the import afterwards: it removes exactly what it added.</p>
        </>
      )}
    </section>
  );
}

interface ImagesProps {
  images: GraphImage[];
  /** Other files in `assets/` (PDFs, SVGs and so on), which stay as links. */
  others: number;
  state: ImageSend;
  onSend: () => void;
}

/** The folder's images: sent apart from the import, so they can be sent before or after it. */
function Images({ images, others, state, onSend }: ImagesProps) {
  if (images.length === 0 && others === 0) return null;
  return (
    <section aria-label="Images" className="mt-6 text-sm">
      <h2 className="text-sm uppercase tracking-wider text-muted">Images</h2>
      {images.length > 0 && (
        <p className="mt-2 text-ink">
          {n(images.length, "image")} in <code>assets</code>. Send them to Mistlog so they show in your pages. This doesn't change any page, and images Mistlog has already are
          skipped, so it's safe to do before or after importing.
        </p>
      )}
      {others > 0 && <p className="mt-2 text-muted">{n(others, "other attachment")} (PDFs and so on) aren't sent; links to them stay as text.</p>}
      {images.length > 0 && state === null && (
        <button type="button" onClick={onSend} className="mt-3 border border-ink px-3 py-1.5 text-sm uppercase tracking-wider text-ink hover:bg-border">
          Send images
        </button>
      )}
      {state?.kind === "sending" && (
        <p role="status" className="mt-3 text-muted">
          Sending images: {state.done.toLocaleString()} of {images.length.toLocaleString()}… Keep this tab open.
        </p>
      )}
      {state?.kind === "sent" && <ImagesSent outcome={state.outcome} />}
    </section>
  );
}

function ImagesSent({ outcome }: { outcome: SendOutcome }) {
  const problems = outcome.tooBig.length + outcome.failed.length;
  return (
    <div role="status" className="mt-3">
      <p className="text-ink">
        {n(outcome.stored, "image")} sent
        {outcome.exists > 0 && `; ${n(outcome.exists, "image")} Mistlog had already`}.
      </p>
      {outcome.tooBig.length > 0 && (
        <Details title={`${n(outcome.tooBig.length, "image")} too big to send (over 10 MB)`}>
          {outcome.tooBig.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </Details>
      )}
      {outcome.failed.length > 0 && (
        <>
          <Details title={`${n(outcome.failed.length, "image")} couldn't be sent`}>
            {outcome.failed.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </Details>
          <p className="mt-2 text-coral">Choose the folder again to try those again; the ones sent are skipped.</p>
        </>
      )}
      {problems === 0 && <p className="mt-1 text-muted">They show in your pages wherever they're linked.</p>}
    </div>
  );
}

function Details({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm text-muted">{title}</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">{children}</ul>
    </details>
  );
}
