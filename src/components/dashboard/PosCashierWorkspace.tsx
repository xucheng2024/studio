"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  completePosCashSaleAction,
  createPosSaleDraftAction,
  createPosSalonCustomerAction,
  deletePosSaleItemAction,
  proceedPosSaleToPaymentAction,
  upsertPosSaleItemAction,
} from "@/app/(app)/dashboard/actions";
import { InvoiceSendButton } from "@/components/InvoiceSendButton";
import { SyncHitpayPaymentButton } from "@/components/SyncHitpayPaymentButton";
import { PosHitpayPaymentButton } from "@/components/dashboard/PosHitpayPaymentButton";
import { ui } from "@/lib/ui";

export type PosCatalogItem = {
  type: "service" | "product" | "package";
  id: string;
  name: string;
  price: number;
  currency: string;
  meta: string;
  stockQty: number | null;
};

export type PosCustomerOption = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
};

export type PosEmployeeOption = {
  id: string;
  display_name: string;
};

export type PosCashierCartItem = {
  id: string | null;
  lineNumber: number;
  type: PosCatalogItem["type"];
  catalogId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  employeeId: string | null;
  currency: string;
  appointmentId: string | null;
};

export type PosCashierSale = {
  id: string;
  status: string;
  salonCustomerId: string | null;
  customerName: string | null;
  totalAmount: number;
  currency: string;
  receiptNumber: string | null;
  items: PosCashierCartItem[];
  payments: Array<{
    id: string;
    status: string;
    payment_method: string | null;
    invoice_number: string | null;
    invoice_status: string | null;
    amount: number;
  }>;
};

type CatalogFilter = "all" | PosCatalogItem["type"];

function money(value: number) {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function formatQty(value: number) {
  if (Number.isInteger(value) || Math.abs(value - Math.round(value)) < 0.0005) {
    return String(Math.round(value));
  }
  return String(value);
}

function lineSubtotal(item: PosCashierCartItem) {
  return Math.round(item.quantity * item.unitPrice * 100) / 100;
}

function lineTotal(item: PosCashierCartItem) {
  return Math.round((lineSubtotal(item) - item.discount) * 100) / 100;
}

function toFormData(entries: Record<string, string | number | null | undefined>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (value == null) continue;
    data.set(key, String(value));
  }
  return data;
}

function lastLocationKey(studioId: string) {
  return `pos:lastLocation:${studioId}`;
}

function lastStaffKey(studioId: string, locationId: string) {
  return `pos:lastStaff:${studioId}:${locationId}`;
}

function quickCashAmounts(total: number) {
  const rounded = Math.ceil(total / 10) * 10;
  const notes = [10, 20, 50, 100].filter((note) => note >= total);
  return [...new Set([total, rounded, ...notes])].sort((a, b) => a - b).slice(0, 6);
}

export function PosCashierWorkspace(props: {
  studioId: string;
  locationId: string | null;
  locationIds: string[];
  locationName: string | null;
  studioSlug: string | null;
  catalog: PosCatalogItem[];
  customers: PosCustomerOption[];
  employees: PosEmployeeOption[];
  cashierEmployeeId: string | null;
  initialSale: PosCashierSale | null;
  initialClientId?: string | null;
  initialAppointmentId?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>("all");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(
    props.initialSale?.salonCustomerId ?? props.initialClientId ?? null,
  );
  const [customers, setCustomers] = useState(props.customers);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [saleId, setSaleId] = useState<string | null>(props.initialSale?.id ?? null);
  const [saleStatus, setSaleStatus] = useState(props.initialSale?.status ?? "draft");
  const [receiptNumber, setReceiptNumber] = useState<string | null>(props.initialSale?.receiptNumber ?? null);
  const [payments, setPayments] = useState(props.initialSale?.payments ?? []);
  const [cart, setCart] = useState<PosCashierCartItem[]>(props.initialSale?.items ?? []);
  const [lastStaffId, setLastStaffId] = useState<string | null>(props.cashierEmployeeId);
  const [tendered, setTendered] = useState("");
  const [busy, setBusy] = useState(false);
  const draftKeyRef = useRef(props.initialSale?.id ? `pos-cashier-existing:${props.initialSale.id}` : crypto.randomUUID());
  const catalogSearchRef = useRef<HTMLInputElement>(null);

  const editable = saleStatus === "draft";
  const due = cart.reduce((sum, item) => sum + lineTotal(item), 0);
  const tenderedAmount = Number(tendered);
  const changeDue = Number.isFinite(tenderedAmount) ? Math.round((tenderedAmount - due) * 100) / 100 : 0;
  const paidPayment = payments.find((payment) => payment.status === "paid") ?? null;

  useEffect(() => {
    if (!props.studioId) return;
    if (props.locationId) {
      window.localStorage.setItem(lastLocationKey(props.studioId), props.locationId);
      return;
    }
    const last = window.localStorage.getItem(lastLocationKey(props.studioId));
    if (!last || !props.locationIds.includes(last)) return;
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("location_id")) return;
    params.set("location_id", last);
    params.delete("tab");
    router.replace(`${pathname}?${params.toString()}`);
  }, [pathname, props.locationId, props.locationIds, props.studioId, router, searchParams]);

  useEffect(() => {
    if (!props.studioId || !props.locationId) return;
    const saved = window.localStorage.getItem(lastStaffKey(props.studioId, props.locationId));
    if (saved && props.employees.some((employee) => employee.id === saved)) {
      setLastStaffId(saved);
      return;
    }
    setLastStaffId(props.cashierEmployeeId);
  }, [props.cashierEmployeeId, props.employees, props.locationId, props.studioId]);

  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      catalogSearchRef.current?.focus();
    }
  }, [props.locationId]);

  const replaceSaleQuery = useCallback((nextSaleId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextSaleId) params.set("sale_id", nextSaleId);
    else params.delete("sale_id");
    params.delete("tab");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  const rememberStaff = useCallback((employeeId: string | null) => {
    if (!employeeId || !props.studioId || !props.locationId) return;
    setLastStaffId(employeeId);
    window.localStorage.setItem(lastStaffKey(props.studioId, props.locationId), employeeId);
  }, [props.locationId, props.studioId]);

  const filteredCustomers = useMemo(() => {
    const needle = customerQuery.trim().toLowerCase();
    if (!needle) return customers.slice(0, 8);
    return customers.filter((customer) => {
      const haystack = `${customer.full_name} ${customer.phone ?? ""} ${customer.email ?? ""}`.toLowerCase();
      return haystack.includes(needle);
    }).slice(0, 8);
  }, [customerQuery, customers]);

  const filteredCatalog = useMemo(() => {
    const needle = catalogQuery.trim().toLowerCase();
    return props.catalog.filter((item) => {
      if (catalogFilter !== "all" && item.type !== catalogFilter) return false;
      if (!needle) return true;
      return `${item.name} ${item.meta}`.toLowerCase().includes(needle);
    });
  }, [catalogFilter, catalogQuery, props.catalog]);

  const selectedCustomer = customers.find((customer) => customer.id === customerId) ?? null;

  async function ensureDraft() {
    if (saleId) return saleId;
    if (!props.locationId) {
      toast.error("Select a location first.");
      return null;
    }
    const result = await createPosSaleDraftAction(null, toFormData({
      studio_id: props.studioId,
      location_id: props.locationId,
      salon_customer_id: customerId,
      idempotency_key: `pos-cashier-draft:${draftKeyRef.current}`,
    }));
    if (!result.ok || !result.sale_id) {
      console.log("POS ensureDraft failed", result);
      toast.error(result.message);
      return null;
    }
    setSaleId(result.sale_id);
    replaceSaleQuery(result.sale_id);
    return result.sale_id;
  }

  async function persistLine(nextSaleId: string, item: PosCashierCartItem) {
    const result = await upsertPosSaleItemAction(null, toFormData({
      studio_id: props.studioId,
      sale_id: nextSaleId,
      item_id: item.id,
      line_number: item.lineNumber,
      item_type: item.type,
      service_id: item.type === "service" ? item.catalogId : null,
      product_id: item.type === "product" ? item.catalogId : null,
      package_id: item.type === "package" ? item.catalogId : null,
      salon_appointment_id: item.appointmentId,
      employee_id: item.employeeId,
      item_name_snapshot: item.name,
      item_currency_snapshot: item.currency,
      quantity: item.quantity,
      unit_price_amount: item.unitPrice,
      discount_amount: item.discount,
      tax_amount: 0,
      idempotency_key: crypto.randomUUID(),
    }));
    if (!result.ok) {
      console.log("POS persistLine failed", { item, result });
      toast.error(result.message);
      return null;
    }
    return {
      ...item,
      id: result.item_id ?? item.id,
      lineNumber: result.line_number ?? item.lineNumber,
    };
  }

  async function addCatalogItem(catalogItem: PosCatalogItem) {
    if (!editable || busy) return;
    if (!props.locationId) {
      toast.error("Select a location first.");
      return;
    }
    const defaultStaff = catalogItem.type === "service"
      ? lastStaffId
      : (lastStaffId ?? props.cashierEmployeeId);
    const mergeIndex = cart.findIndex((item) => (
      item.type === catalogItem.type
      && item.catalogId === catalogItem.id
      && (item.employeeId ?? "") === (defaultStaff ?? "")
    ));
    const nextQty = mergeIndex >= 0 ? cart[mergeIndex].quantity + 1 : 1;
    if (catalogItem.stockQty != null && nextQty > catalogItem.stockQty) {
      toast.error(`Only ${formatQty(catalogItem.stockQty)} in stock.`);
      return;
    }

    setBusy(true);
    try {
      const nextSaleId = await ensureDraft();
      if (!nextSaleId) return;
      if (mergeIndex >= 0) {
        const updated = { ...cart[mergeIndex], quantity: nextQty };
        const saved = await persistLine(nextSaleId, updated);
        if (!saved) return;
        setCart((current) => current.map((item, index) => (index === mergeIndex ? saved : item)));
        return;
      }
      const created: PosCashierCartItem = {
        id: null,
        lineNumber: (cart.at(-1)?.lineNumber ?? 0) + 1,
        type: catalogItem.type,
        catalogId: catalogItem.id,
        name: catalogItem.name,
        quantity: 1,
        unitPrice: catalogItem.price,
        discount: 0,
        employeeId: defaultStaff,
        currency: catalogItem.currency,
        appointmentId: props.initialAppointmentId ?? null,
      };
      const saved = await persistLine(nextSaleId, created);
      if (!saved) return;
      setCart((current) => [...current, saved]);
    } finally {
      setBusy(false);
    }
  }

  async function updateCartItem(lineNumber: number, patch: Partial<PosCashierCartItem>) {
    if (!editable || !saleId || busy) return;
    const current = cart.find((item) => item.lineNumber === lineNumber);
    if (!current) return;
    const next = { ...current, ...patch };
    if (next.quantity < 1) next.quantity = 1;
    const subtotal = lineSubtotal(next);
    if (next.discount > subtotal) next.discount = subtotal;
    if (next.discount < 0) next.discount = 0;
    setBusy(true);
    try {
      const saved = await persistLine(saleId, next);
      if (!saved) return;
      setCart((items) => items.map((item) => (item.lineNumber === lineNumber ? saved : item)));
      if (patch.employeeId) rememberStaff(patch.employeeId);
    } finally {
      setBusy(false);
    }
  }

  async function deleteCartItem(lineNumber: number) {
    if (!editable || !saleId || busy) return;
    const current = cart.find((item) => item.lineNumber === lineNumber);
    if (!current) return;
    setBusy(true);
    try {
      const result = await deletePosSaleItemAction(null, toFormData({
        studio_id: props.studioId,
        sale_id: saleId,
        item_id: current.id,
        line_number: current.lineNumber,
        idempotency_key: crypto.randomUUID(),
      }));
      if (!result.ok) {
        console.log("POS deleteCartItem failed", { current, result });
        toast.error(result.message);
        return;
      }
      setCart((items) => items.filter((item) => item.lineNumber !== lineNumber));
    } finally {
      setBusy(false);
    }
  }

  async function createCustomer() {
    if (!props.locationId || busy) return;
    setBusy(true);
    try {
      const result = await createPosSalonCustomerAction(null, toFormData({
        studio_id: props.studioId,
        location_id: props.locationId,
        full_name: newName,
        phone: newPhone,
        email: newEmail,
      }));
      if (!result.ok || !result.customer_id || !result.full_name) {
        console.log("POS createCustomer failed", result);
        toast.error(result.message);
        return;
      }
      const created = {
        id: result.customer_id,
        full_name: result.full_name,
        phone: result.phone ?? null,
        email: result.email ?? null,
      };
      setCustomers((current) => [created, ...current.filter((customer) => customer.id !== created.id)]);
      setCustomerId(created.id);
      setShowNewCustomer(false);
      setNewName("");
      setNewPhone("");
      setNewEmail("");
      toast.success(result.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmCash() {
    if (!saleId || busy) return;
    if (cart.length === 0) {
      toast.error("Add at least one item.");
      return;
    }
    const missingStaff = cart.filter((item) => item.type === "service" && !item.employeeId);
    if (missingStaff.length > 0) {
      toast.error("Assign staff to every service.");
      return;
    }
    if (saleStatus === "draft" && (!Number.isFinite(tenderedAmount) || tenderedAmount + 0.001 < due)) {
      toast.error("Cash received must cover the total.");
      return;
    }
    setBusy(true);
    try {
      const ready = await proceedPosSaleToPaymentAction(null, toFormData({
        studio_id: props.studioId,
        sale_id: saleId,
        idempotency_key: `pos-lock:${saleId}:${cart.length}:${money(due)}`,
      }));
      if (!ready.ok) {
        console.log("POS cash proceed failed", ready);
        toast.error(ready.message);
        return;
      }
      const paid = await completePosCashSaleAction(null, toFormData({
        studio_id: props.studioId,
        sale_id: saleId,
        idempotency_key: `pos-cash-complete:${saleId}`,
      }));
      if (!paid.ok) {
        console.log("POS cash complete failed", paid);
        toast.error(paid.message);
        return;
      }
      setSaleStatus(paid.sale_status ?? "paid");
      setReceiptNumber(paid.receipt_number ?? receiptNumber);
      if (paid.payment_id) {
        setPayments((current) => {
          if (current.some((payment) => payment.id === paid.payment_id)) return current;
          return [{
            id: paid.payment_id!,
            status: "paid",
            payment_method: "cash",
            invoice_number: null,
            invoice_status: null,
            amount: due,
          }, ...current];
        });
      }
      toast.success(paid.message);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function startHitpay() {
    if (!saleId || busy) return;
    if (cart.length === 0) {
      toast.error("Add at least one item.");
      return;
    }
    const missingStaff = cart.filter((item) => item.type === "service" && !item.employeeId);
    if (missingStaff.length > 0) {
      toast.error("Assign staff to every service.");
      return;
    }
    setBusy(true);
    try {
      const ready = await proceedPosSaleToPaymentAction(null, toFormData({
        studio_id: props.studioId,
        sale_id: saleId,
        idempotency_key: `pos-lock:${saleId}:${cart.length}:${money(due)}`,
      }));
      if (!ready.ok) {
        console.log("POS HitPay proceed failed", ready);
        toast.error(ready.message);
        return;
      }
      setSaleStatus("pending_payment");
      toast.success(ready.message);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function newSale() {
    draftKeyRef.current = crypto.randomUUID();
    setSaleId(null);
    setSaleStatus("draft");
    setReceiptNumber(null);
    setPayments([]);
    setCart([]);
    setCustomerId(null);
    setTendered("");
    setShowNewCustomer(false);
    replaceSaleQuery(null);
  }

  if (!props.locationId) {
    return (
      <section className={ui.card}>
        <p className={ui.muted}>Select a location to start selling.</p>
      </section>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
      <section className={`${ui.card} flex flex-col gap-3`}>
        <div className="flex flex-wrap gap-2">
          {(["all", "service", "product", "package"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              className={catalogFilter === filter ? ui.badge : ui.badgeNeutral}
              onClick={() => setCatalogFilter(filter)}
            >
              {filter === "all" ? "All" : `${filter}s`}
            </button>
          ))}
        </div>
        <input
          ref={catalogSearchRef}
          type="search"
          value={catalogQuery}
          onChange={(event) => setCatalogQuery(event.target.value)}
          className={ui.input}
          placeholder="Search services, products, packages"
          autoComplete="off"
          disabled={!editable}
        />
        {filteredCatalog.length === 0 ? (
          <p className={ui.muted}>No matching items for this location.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {filteredCatalog.map((item) => (
              <button
                key={`${item.type}:${item.id}`}
                type="button"
                disabled={!editable || busy || (item.stockQty != null && item.stockQty <= 0)}
                onClick={() => void addCatalogItem(item)}
                className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-left transition hover:border-teal-300 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-800 dark:bg-stone-950"
              >
                <p className="text-sm font-medium text-stone-900 dark:text-stone-100">{item.name}</p>
                <p className={`mt-1 text-xs capitalize ${ui.muted}`}>{item.type}{item.meta ? ` · ${item.meta}` : ""}</p>
                <p className="mt-2 text-sm font-semibold text-teal-800 dark:text-teal-300">SGD {money(item.price)}</p>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className={ui.card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className={ui.h2}>Customer</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={!customerId ? ui.badge : ui.badgeNeutral}
                disabled={!editable || Boolean(saleId)}
                onClick={() => setCustomerId(null)}
              >
                Walk-in
              </button>
              <button
                type="button"
                className={ui.btnGhost}
                disabled={!editable || Boolean(saleId)}
                onClick={() => setShowNewCustomer((value) => !value)}
              >
                New
              </button>
            </div>
          </div>
          {saleId && editable ? (
            <p className={`mt-2 text-xs ${ui.muted}`}>Customer is locked for this sale. Start a new sale to change it.</p>
          ) : null}
          <p className="mt-2 text-sm font-medium text-stone-900 dark:text-stone-100">
            {selectedCustomer ? selectedCustomer.full_name : "Walk-in"}
          </p>
          {selectedCustomer?.phone || selectedCustomer?.email ? (
            <p className={`text-xs ${ui.muted}`}>{[selectedCustomer.phone, selectedCustomer.email].filter(Boolean).join(" · ")}</p>
          ) : null}
          {editable && !saleId ? (
            <>
              <input
                type="search"
                value={customerQuery}
                onChange={(event) => setCustomerQuery(event.target.value)}
                className={`${ui.input} mt-3`}
                placeholder="Search name, phone, or email"
                autoComplete="off"
              />
              {customerQuery.trim() ? (
                <div className="mt-2 flex flex-col gap-1">
                  {filteredCustomers.length === 0 ? (
                    <p className={`text-xs ${ui.muted}`}>No match. Create a customer or use Walk-in.</p>
                  ) : filteredCustomers.map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      className="rounded-lg px-2 py-1.5 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800"
                      onClick={() => {
                        setCustomerId(customer.id);
                        setCustomerQuery("");
                      }}
                    >
                      {customer.full_name}
                      <span className={`ml-2 text-xs ${ui.muted}`}>{customer.phone ?? customer.email ?? ""}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {showNewCustomer ? (
                <div className="mt-3 grid gap-2">
                  <input className={ui.input} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Name" />
                  <input className={ui.input} value={newPhone} onChange={(event) => setNewPhone(event.target.value)} placeholder="Phone" />
                  <input className={ui.input} value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="Email" />
                  <button type="button" className={ui.btnSecondarySm} disabled={busy} onClick={() => void createCustomer()}>
                    Save customer
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className={ui.card}>
          <div className="flex items-center justify-between gap-2">
            <h2 className={ui.h2}>Cart</h2>
            <div className="flex items-center gap-2">
              {props.locationName ? <span className={`text-xs ${ui.muted}`}>{props.locationName}</span> : null}
              <button type="button" className={ui.btnGhost} onClick={newSale}>New sale</button>
            </div>
          </div>
          {cart.length === 0 ? (
            <p className={`mt-3 ${ui.muted}`}>Tap an item to add it.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {cart.map((item) => (
                <li key={`${item.lineNumber}:${item.id ?? item.catalogId}`} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-stone-900 dark:text-stone-100">{item.name}</p>
                      <p className={`text-xs capitalize ${ui.muted}`}>{item.type}</p>
                    </div>
                    <p className="text-sm font-semibold">SGD {money(lineTotal(item))}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button type="button" className={ui.btnSecondarySm} disabled={!editable || busy || item.quantity <= 1} onClick={() => void updateCartItem(item.lineNumber, { quantity: item.quantity - 1 })}>-</button>
                    <span className="min-w-6 text-center text-sm">{formatQty(item.quantity)}</span>
                    <button type="button" className={ui.btnSecondarySm} disabled={!editable || busy} onClick={() => void updateCartItem(item.lineNumber, { quantity: item.quantity + 1 })}>+</button>
                    <button
                      type="button"
                      aria-label="Remove item"
                      title="Remove item"
                      className={`${ui.btnSecondarySm} border-red-200 text-red-600 dark:border-red-800 dark:text-red-400 disabled:opacity-50`}
                      disabled={!editable || busy}
                      onClick={() => void deleteCartItem(item.lineNumber)}
                    >
                      <Trash2 size={12} />
                    </button>
                    <select
                      className={`${ui.select} min-w-36 flex-1`}
                      value={item.employeeId ?? ""}
                      disabled={!editable || busy}
                      onChange={(event) => void updateCartItem(item.lineNumber, { employeeId: event.target.value || null })}
                    >
                      <option value="">{item.type === "service" ? "Select staff" : "No staff"}</option>
                      {props.employees.map((employee) => (
                        <option key={employee.id} value={employee.id}>{employee.display_name}</option>
                      ))}
                    </select>
                  </div>
                  {editable ? (
                    <label className="mt-2 flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300">
                      Discount
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={item.discount || ""}
                        className={`${ui.input} !min-h-8 py-1`}
                        disabled={busy}
                        onBlur={(event) => {
                          const value = Number(event.target.value);
                          void updateCartItem(item.lineNumber, {
                            discount: Number.isFinite(value) ? value : 0,
                          });
                        }}
                      />
                    </label>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={`${ui.card} ${ui.mobileActionBar} flex flex-col gap-3`}>
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className={ui.muted}>Due</p>
              <p className="text-2xl font-semibold text-stone-900 dark:text-stone-50">SGD {money(due)}</p>
            </div>
            {receiptNumber ? <p className="text-xs font-medium text-teal-800 dark:text-teal-300">Receipt {receiptNumber}</p> : null}
          </div>

          {saleStatus === "paid" || saleStatus === "partially_refunded" || saleStatus === "refunded" ? (
            <div className="flex flex-wrap gap-2">
              {paidPayment ? (
                <InvoiceSendButton
                  paymentId={paidPayment.id}
                  invoiceNumber={paidPayment.invoice_number}
                  previewMode="invoice"
                  allowSend={paidPayment.status === "paid" && Boolean(selectedCustomer?.email)}
                />
              ) : null}
              <button type="button" className={ui.btnPrimary} onClick={newSale}>New sale</button>
            </div>
          ) : (
            <>
              {saleStatus === "draft" ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    {quickCashAmounts(due).map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        className={ui.btnSecondarySm}
                        onClick={() => setTendered(money(amount))}
                      >
                        {amount === due ? "Exact" : `SGD ${money(amount)}`}
                      </button>
                    ))}
                  </div>
                  <label className="flex flex-col gap-1.5">
                    <span className={ui.label}>Cash received</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={tendered}
                      onChange={(event) => setTendered(event.target.value)}
                      className={ui.input}
                      placeholder="0.00"
                    />
                  </label>
                  <p className="text-sm font-medium text-stone-800 dark:text-stone-100">
                    Change SGD {Number.isFinite(tenderedAmount) ? money(Math.max(0, changeDue)) : "0.00"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={ui.btnPrimary} disabled={busy || cart.length === 0} onClick={() => void confirmCash()}>
                      {busy ? "Taking payment…" : "Confirm cash"}
                    </button>
                    <button type="button" className={ui.btnSecondary} disabled={busy || cart.length === 0 || due <= 0} onClick={() => void startHitpay()}>
                      HitPay
                    </button>
                  </div>
                </>
              ) : null}
              {saleStatus === "pending_payment" && saleId ? (
                <div className="flex flex-col gap-2">
                  <p className={`text-xs ${ui.muted}`}>Sale is locked. Confirm cash or keep this page open for HitPay.</p>
                  <button type="button" className={ui.btnPrimary} disabled={busy} onClick={() => void confirmCash()}>
                    Confirm cash
                  </button>
                  <PosHitpayPaymentButton studioId={props.studioId} saleId={saleId} disabled={busy} />
                  {props.studioSlug && (payments.find((payment) => payment.status === "pending") ?? payments[0]) ? (
                    <SyncHitpayPaymentButton
                      paymentId={(payments.find((payment) => payment.status === "pending") ?? payments[0])!.id}
                      studioSlug={props.studioSlug}
                    />
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
