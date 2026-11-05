import { useState, type ChangeEvent } from "react";
import { convertGraph, summarise, type ImportFile, type ImportPlan, type ImportSummary, type ExistingInMistlog } from "~/lib/logseq-import";

type Stage =
  | { kind: "idle" }
  | { kind: "reading"; done: number; total: number }
  | { kind: "checking" }
  | { kind: "ready"; plan: ImportPlan; summary: ImportSummary }
  | { kind: "failed"; message: string };

export async function checkExisting(plan: ImportPlan): Promise<ExistingInMistlog> {
  const titles = [...plan.pages.filter((p) => p.kind === "page").map((p) => p.title), ...plan.missingTitles];
  const dates = plan.pages.flatMap((p) => (p.date ? [p.date] : []));
  const res = await fetch("/api/import/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titles, dates }) });
  if (!res.ok) throw new Error(`check: ${res.status}`);
  return (await res.json()) as ExistingInMistlog;
}

/** Only Markdown and Org files need their text; the rest are counted or skipped. */
const NEEDS_TEXT = /\.(md|org)$/i;

/**
 * Import from Logseq, step 1: the dry run (PRD F31). Pick a graph folder;
 * its files are read and converted in this browser (logseq-import.ts), and
 * only titles and dates are sent to see what already exists. The report says
 * what an import would do. Nothing is written.
 */
export default function ImportView({ check = checkExisting }: { check?: typeof checkExisting }) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

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

  return (
    <div className="mx-6 mb-10 mt-8 max-w-[65ch]">
      <h1 className="text-[1.75rem] font-semibold leading-tight text-ink">Import from Logseq</h1>
      <p className="mt-2 text-sm text-muted">
        Choose your Logseq graph's folder (the one with <code>pages</code> and <code>journals</code> in it). It is read in this browser; only page titles and dates are sent, to see
        what Mistlog has already. This is a dry run: nothing is written.
      </p>
      <label className="mt-4 inline-block cursor-pointer border border-border px-3 py-1.5 text-sm uppercase tracking-wider hover:bg-border">
        Choose folder
        <input type="file" multiple className="sr-only" onChange={(e) => void pick(e)} {...{ webkitdirectory: "", directory: "" }} />
      </label>
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
      {stage.kind === "failed" && (
        <p role="alert" className="mt-4 text-sm text-coral">
          {stage.message}
        </p>
      )}
      {stage.kind === "ready" && <Report plan={stage.plan} summary={stage.summary} />}
    </div>
  );
}

function Report({ plan, summary }: { plan: ImportPlan; summary: ImportSummary }) {
  const { stats } = plan;
  const n = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
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
      <button type="button" disabled className="mt-6 border border-border px-3 py-1.5 text-sm uppercase tracking-wider text-muted opacity-60" title="Importing arrives in the next update">
        Import
      </button>
      <p className="mt-2 text-xs text-muted">Importing arrives in the next update. Nothing has been written.</p>
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
