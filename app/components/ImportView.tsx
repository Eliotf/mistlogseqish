import { useState, useSyncExternalStore, type ChangeEvent } from "react";
import { Link } from "react-router";
import { convertGraph, summarise, titlesToResolve, type ImportFile, type ImportPlan, type ImportSummary, type ExistingInMistlog } from "~/lib/logseq-import";
import type { ImportRecord } from "~/lib/import-lines";
import { importApi, runImport, runUndo, type ImportApi, type ImportOutcome, type ImportProgress } from "~/lib/import-run";

type Stage =
  | { kind: "idle" }
  | { kind: "reading"; done: number; total: number }
  | { kind: "checking" }
  | { kind: "ready"; plan: ImportPlan; summary: ImportSummary }
  | { kind: "importing"; progress: ImportProgress | null }
  | { kind: "imported"; outcome: ImportOutcome }
  | { kind: "confirm-undo" }
  | { kind: "undoing"; left: number | null }
  | { kind: "undone" }
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
  /** The import not yet undone, if any (from the route's loader). */
  current: ImportRecord | null;
  check?: typeof checkExisting;
  api?: ImportApi;
  wait?: (ms: number) => Promise<unknown>;
}

/**
 * Import from Logseq (PRD F31). Pick a graph folder; its files are read and
 * converted in this browser (logseq-import.ts), and only titles and dates
 * are sent to see what already exists. The report says what an import would
 * do; nothing is written until Import. One import at a time: it can be
 * undone (exactly the lines it added, and the pages it created), and one cut
 * short can be continued by choosing the folder again.
 */
export default function ImportView({ current: initial, check = checkExisting, api = importApi, wait }: ImportViewProps) {
  const [current, setCurrent] = useState(initial);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const busy = stage.kind === "importing" || stage.kind === "undoing" || stage.kind === "reading" || stage.kind === "checking";
  // A finished import blocks another until undone; an unfinished one is continued with its folder
  const canPick = !busy && (!current || current.state === "running");

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const list = [...(event.target.files ?? [])];
    if (!list.length) return;
    setStage({ kind: "reading", done: 0, total: list.length });
    try {
      const files: ImportFile[] = [];
      for (const [i, file] of list.entries()) {
        const path = file.webkitRelativePath || file.name;
        files.push({ path, text: NEEDS_TEXT.test(path) ? await file.text() : "" });
        if (i % 50 === 0) setStage({ kind: "reading", done: i, total: list.length });
      }
      const plan = convertGraph(files);
      setStage({ kind: "checking" });
      const existing = await check(plan);
      setStage({ kind: "ready", plan, summary: summarise(plan, existing) });
    } catch (err) {
      console.error("Import dry run failed", err);
      setStage({ kind: "failed", message: "Couldn't read the folder or reach Mistlog. Try again in a moment." });
    }
  };

  const start = async (plan: ImportPlan) => {
    setStage({ kind: "importing", progress: null });
    try {
      let importId = current?.state === "running" ? current.importId : null;
      if (!importId) {
        const started = await api.start();
        if (!started.ok) {
          setCurrent(started.current);
          setStage({ kind: "failed", message: "An import exists already. Undo it to import again." });
          return;
        }
        importId = started.importId;
        setCurrent({ importId, state: "running", startedAt: Date.now(), finishedAt: null, pages: 0, created: 0 });
      }
      const outcome = await runImport(importId, plan, (progress) => setStage({ kind: "importing", progress }), { api, wait });
      setCurrent((c) => outcome.record ?? (c ? { ...c, state: "done", finishedAt: Date.now() } : c));
      setStage({ kind: "imported", outcome });
    } catch (err) {
      console.error("Import failed", err);
      setStage({ kind: "failed", message: "The import stopped before it finished. Choose the folder again to continue it, or undo it." });
    }
  };

  const undo = async () => {
    if (!current) return;
    setStage({ kind: "undoing", left: null });
    try {
      await runUndo(current.importId, (left) => setStage({ kind: "undoing", left }), { api, wait });
      setCurrent(null);
      setStage({ kind: "undone" });
    } catch (err) {
      console.error("Undoing the import failed", err);
      setCurrent((c) => (c ? { ...c, state: "undoing" } : c));
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
      {current && !busy && stage.kind !== "imported" && <CurrentImport current={current} onUndo={() => setStage({ kind: "confirm-undo" })} />}
      {stage.kind === "confirm-undo" && current && <ConfirmUndo current={current} onConfirm={() => void undo()} onCancel={() => setStage({ kind: "idle" })} />}
      {canPick && stage.kind !== "confirm-undo" && (
        <label className="mt-4 inline-block cursor-pointer border border-border px-3 py-1.5 text-sm uppercase tracking-wider hover:bg-border focus-within:outline focus-within:outline-2">
          Choose folder
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
          The import is undone. You can import again.
        </p>
      )}
      {stage.kind === "failed" && (
        <p role="alert" className="mt-4 text-sm text-coral">
          {stage.message}
        </p>
      )}
      {stage.kind === "ready" && <Report plan={stage.plan} summary={stage.summary} continuing={current?.state === "running"} onImport={() => void start(stage.plan)} />}
      {stage.kind === "imported" && <Imported outcome={stage.outcome} onUndo={() => setStage({ kind: "confirm-undo" })} />}
    </div>
  );
}

const noSubscription = () => () => {};

function CurrentImport({ current, onUndo }: { current: ImportRecord; onUndo: () => void }) {
  // In the browser's own locale and time zone; blank on the server, so hydration matches
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  const date = new Date(current.finishedAt ?? current.startedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const when = inBrowser ? ` on ${date}` : "";
  const message =
    current.state === "done"
      ? `You imported a Logseq graph${when} (${n(current.pages, "page or day", "pages and days")}). Undo it to import again.`
      : current.state === "running"
        ? `An import started${when} didn't finish. Choose the folder again to continue it, or undo it.`
        : "Undoing an import didn't finish.";
  return (
    <section aria-label="Your import" className="mt-4 border border-border p-3 text-sm">
      <p className="text-ink">{message}</p>
      <button type="button" onClick={onUndo} className="mt-2 text-coral underline">
        {current.state === "undoing" ? "Continue undoing" : "Undo this import"}
      </button>
    </section>
  );
}

function ConfirmUndo({ current, onConfirm, onCancel }: { current: ImportRecord; onConfirm: () => void; onCancel: () => void }) {
  return (
    <section aria-label="Undo the import" className="mt-4 border border-coral p-3 text-sm">
      <p className="text-ink">
        Undo this import? It removes every line it added, even ones you have edited since, and deletes the {n(current.created, "page")} it created (with anything written on them since).
        Lines you wrote yourself on other pages and days stay.
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

function Imported({ outcome, onUndo }: { outcome: ImportOutcome; onUndo: () => void }) {
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
        <button type="button" onClick={onUndo} className="text-coral underline">
          Undo this import
        </button>
      </div>
    </section>
  );
}

function Report({ plan, summary, continuing, onImport }: { plan: ImportPlan; summary: ImportSummary; continuing: boolean; onImport: () => void }) {
  const { stats } = plan;
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
        {stats.assets > 0 && <li>{n(stats.assets, "attachment")} (images, PDFs) not imported yet; links to them stay as text</li>}
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
      <button type="button" onClick={onImport} className="mt-6 border border-ink px-3 py-1.5 text-sm uppercase tracking-wider text-ink hover:bg-border">
        {continuing ? "Continue import" : "Import"}
      </button>
      <p className="mt-2 text-xs text-muted">You can undo the import afterwards: it removes exactly what it added.</p>
    </section>
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
