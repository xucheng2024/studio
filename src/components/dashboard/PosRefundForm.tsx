"use client";

import { refundPosSaleItemsAction } from "@/app/(app)/dashboard/actions";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { ui } from "@/lib/ui";

type RefundItem = {
  id: string;
  line_number: number;
  item_type: string;
  item_name_snapshot: string;
  item_currency_snapshot: string;
  quantity: number;
  refunded_quantity: number;
  total_amount: number;
  refunded_amount: number;
};

function formatQty(value: number) {
  if (Number.isInteger(value) || Math.abs(value - Math.round(value)) < 0.0005) {
    return String(Math.round(value));
  }
  return String(value);
}

export function PosRefundForm(props: {
  studioId: string;
  saleId: string;
  idempotencyKey: string;
  items: RefundItem[];
}) {
  return (
    <ServerActionToastForm action={refundPosSaleItemsAction} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="studio_id" value={props.studioId} />
      <input type="hidden" name="sale_id" value={props.saleId} />
      <input type="hidden" name="idempotency_key" value={props.idempotencyKey} />

      <label className="flex max-w-xl flex-col gap-1 text-xs text-stone-700 dark:text-stone-300">
        <span>Refund reason</span>
        <input
          type="text"
          name="reason"
          required
          maxLength={240}
          placeholder="Required reason"
          className={ui.input}
        />
      </label>

      <div className="flex flex-col gap-3">
        {props.items.map((item) => {
          const remainingQty = Math.max(0, Number(item.quantity) - Number(item.refunded_quantity));
          const remainingAmount = Math.max(0, Number(item.total_amount) - Number(item.refunded_amount));
          const isFullyRefunded = remainingAmount <= 0.0001;
          return (
            <fieldset
              key={item.id}
              disabled={isFullyRefunded}
              className="rounded-xl border border-stone-200 p-3 disabled:opacity-50 dark:border-stone-800"
            >
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="refund_item_id"
                  value={item.id}
                  className="mt-1 h-4 w-4 rounded border-stone-300 text-teal-600 focus:ring-teal-500"
                />
                <span>
                  <span className="font-medium text-stone-900 dark:text-stone-100">{item.item_name_snapshot}</span>
                  <span className={`ml-2 text-xs capitalize ${ui.muted}`}>{item.item_type}</span>
                  <span className={`mt-1 block text-xs ${ui.muted}`}>
                    Remaining {formatQty(remainingQty)} · {item.item_currency_snapshot} {remainingAmount.toFixed(2)}
                  </span>
                </span>
              </label>
              <div className="mt-2 flex flex-wrap items-end gap-2 pl-6">
                <label className="flex flex-col gap-1 text-xs">
                  Qty
                  <input
                    type="number"
                    name={`refund_qty__${item.id}`}
                    min="0"
                    step="1"
                    placeholder="Qty"
                    className={`${ui.input} !min-h-8 w-24 py-1`}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Amount
                  <input
                    type="number"
                    name={`refund_amount__${item.id}`}
                    min="0"
                    step="0.01"
                    placeholder="Amount"
                    className={`${ui.input} !min-h-8 w-28 py-1`}
                  />
                </label>
                <button
                  type="button"
                  className={ui.btnGhost}
                  onClick={(event) => {
                    const row = event.currentTarget.closest("fieldset");
                    if (!row) return;
                    const checkbox = row.querySelector<HTMLInputElement>("input[name='refund_item_id']");
                    const qty = row.querySelector<HTMLInputElement>(`input[name='refund_qty__${item.id}']`);
                    const amount = row.querySelector<HTMLInputElement>(`input[name='refund_amount__${item.id}']`);
                    if (checkbox) checkbox.checked = true;
                    if (remainingQty > 0) {
                      if (qty) qty.value = formatQty(remainingQty);
                      if (amount) amount.value = "";
                    } else {
                      if (qty) qty.value = "";
                      if (amount) amount.value = remainingAmount.toFixed(2);
                    }
                  }}
                >
                  Refund remaining
                </button>
              </div>
            </fieldset>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-xs ${ui.muted}`}>Fill qty or amount for each selected row, not both.</p>
        <button type="submit" className={ui.btnDangerSm}>Refund items</button>
      </div>
    </ServerActionToastForm>
  );
}
