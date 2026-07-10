"use client";

import { useState } from "react";
import { AlertTriangle, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ui } from "@/lib/ui";

type FaqRow = {
  id: string;
  studio_id: string;
  question: string;
  answer: string;
  sort_order: number;
  created_at?: string | null;
};

function sortFaqs(rows: FaqRow[]) {
  return [...rows].sort((a, b) => {
    const orderDiff = Number(a.sort_order ?? 100) - Number(b.sort_order ?? 100);
    if (orderDiff !== 0) return orderDiff;
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  });
}

function FaqItemEditor({
  faq,
  onSave,
  onRemove,
}: {
  faq: FaqRow;
  onSave: (id: string, patch: Pick<FaqRow, "question" | "answer" | "sort_order">) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [question, setQuestion] = useState(faq.question);
  const [answer, setAnswer] = useState(faq.answer);
  const [sortOrder, setSortOrder] = useState(String(faq.sort_order ?? 100));
  const [busy, setBusy] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await onSave(faq.id, {
        question: question.trim(),
        answer: answer.trim(),
        sort_order: Number(sortOrder),
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await onRemove(faq.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={ui.card}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-stone-900 dark:text-stone-100">{faq.question}</p>
          <p className={`mt-0.5 text-xs ${ui.muted}`}>Priority {faq.sort_order ?? 100}</p>
        </div>
        {removeConfirm ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs dark:border-red-800/50 dark:bg-red-950/20">
            <AlertTriangle size={11} className="shrink-0 text-red-600 dark:text-red-400" />
            <button type="button" className="font-semibold text-red-700 hover:underline dark:text-red-400" onClick={() => void remove()}>
              Remove?
            </button>
            <button type="button" className="text-stone-400 hover:text-stone-600" onClick={() => setRemoveConfirm(false)}>
              <X size={11} />
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={busy}
            className={`${ui.btnSecondarySm} border-red-200 text-red-600 dark:border-red-800 dark:text-red-400 disabled:opacity-50`}
            onClick={() => setRemoveConfirm(true)}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      <details className="chevron mt-3 rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-700">
        <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-stone-700 dark:text-stone-300">
          <Pencil size={12} />
          Edit FAQ
        </summary>
        <div className="mt-3 grid gap-3">
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Question</span>
            <input className={ui.input} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Answer</span>
            <textarea className={`${ui.input} min-h-28`} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={6000} />
          </label>
          <label className="flex flex-col gap-1 sm:max-w-[180px]">
            <span className={ui.label}>Priority</span>
            <input className={ui.input} type="number" min={0} max={9999} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </label>
          <button type="button" disabled={busy} className={`${ui.btnPrimarySm} w-fit disabled:opacity-50`} onClick={() => void save()}>
            <Save size={12} />
            Save FAQ
          </button>
        </div>
      </details>
    </li>
  );
}

export function StudioFaqManager({ studioId, initialFaqs }: { studioId: string; initialFaqs: FaqRow[] }) {
  const [faqs, setFaqs] = useState(() => sortFaqs(initialFaqs));
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sortOrder, setSortOrder] = useState("100");
  const [creating, setCreating] = useState(false);

  const createFaq = async () => {
    if (!question.trim() || !answer.trim()) {
      toast.error("Question and answer are required.");
      return;
    }
    setCreating(true);
    const res = await fetch("/api/dashboard/faqs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studio_id: studioId,
        question: question.trim(),
        answer: answer.trim(),
        sort_order: Number(sortOrder || 100),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setCreating(false);
    if (!res.ok) {
      toast.error(body.error ?? "Could not create FAQ");
      return;
    }
    setFaqs((current) => sortFaqs([...(current ?? []), body.row as FaqRow]));
    setQuestion("");
    setAnswer("");
    setSortOrder("100");
    toast.success("FAQ created");
  };

  const saveFaq = async (id: string, patch: Pick<FaqRow, "question" | "answer" | "sort_order">) => {
    if (!patch.question.trim() || !patch.answer.trim() || !Number.isFinite(patch.sort_order)) {
      toast.error("Question, answer, and priority are required.");
      return;
    }
    const res = await fetch(`/api/dashboard/faqs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not save FAQ");
      return;
    }
    setFaqs((current) => sortFaqs(current.map((item) => (item.id === id ? (body.row as FaqRow) : item))));
    toast.success("FAQ saved");
  };

  const removeFaq = async (id: string) => {
    const res = await fetch(`/api/dashboard/faqs/${id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not remove FAQ");
      return;
    }
    setFaqs((current) => current.filter((item) => item.id !== id));
    toast.success("FAQ removed");
  };

  return (
    <div className="flex flex-col gap-6">
      <section className={ui.card}>
        <div className="flex flex-col gap-1">
          <h2 className={ui.h2}>Add FAQ item</h2>
          <p className={ui.muted}>Use a lower priority number to show an item earlier on the public page.</p>
        </div>
        <div className="mt-4 grid gap-3">
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Question</span>
            <input className={ui.input} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} placeholder="Do I need to bring anything?" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Answer</span>
            <textarea className={`${ui.input} min-h-28`} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={6000} placeholder="Bring comfortable clothes and a water bottle." />
          </label>
          <label className="flex flex-col gap-1 sm:max-w-[180px]">
            <span className={ui.label}>Priority</span>
            <input className={ui.input} type="number" min={0} max={9999} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </label>
          <button type="button" disabled={creating} className={`${ui.btnPrimary} w-full sm:w-fit disabled:opacity-50`} onClick={() => void createFaq()}>
            <Plus size={16} />
            Add FAQ
          </button>
        </div>
      </section>

      <section>
        <h2 className={ui.h2}>Existing FAQ items</h2>
        <p className={`mt-1 ${ui.muted}`}>Public page order follows priority, then creation time.</p>
        {faqs.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-3">
            {faqs.map((faq) => (
              <FaqItemEditor key={faq.id} faq={faq} onSave={saveFaq} onRemove={removeFaq} />
            ))}
          </ul>
        ) : (
          <div className={`${ui.emptyState} mt-4`}>
            <p className={ui.muted}>No FAQ items yet.</p>
          </div>
        )}
      </section>
    </div>
  );
}
