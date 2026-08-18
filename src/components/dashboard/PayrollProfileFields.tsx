"use client";

import { useState, type ReactNode } from "react";
import { ui } from "@/lib/ui";

type Props = {
  defaultResidency: string;
  defaultPrGrantedOn: string;
  defaultShgFund: string;
  defaultShgMode: string;
  defaultShgCustomAmount: string;
  defaultShgProofNote: string;
  defaultCpfFullRate: boolean;
  defaultEaPart4: boolean;
  defaultIsWorkman: boolean;
  children?: ReactNode;
};

export function PayrollProfileFields({
  defaultResidency,
  defaultPrGrantedOn,
  defaultShgFund,
  defaultShgMode,
  defaultShgCustomAmount,
  defaultShgProofNote,
  defaultCpfFullRate,
  defaultEaPart4,
  defaultIsWorkman,
  children,
}: Props) {
  const [residency, setResidency] = useState(defaultResidency);
  const [shgFund, setShgFund] = useState(defaultShgFund);
  const [shgMode, setShgMode] = useState(defaultShgMode || "standard");
  const showShgDetails = Boolean(shgFund && shgFund !== "none");
  const showShgCustom = showShgDetails && shgMode === "custom_amount";
  const showShgProof = showShgDetails && (shgMode === "opt_out" || shgMode === "custom_amount");

  return (
    <div className="contents">
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>Residency</span>
        <select
          className={ui.select}
          name="residency_status"
          value={residency}
          onChange={(event) => setResidency(event.target.value)}
        >
          <option value="">Select</option>
          <option value="citizen">Singapore citizen</option>
          <option value="pr">PR</option>
          <option value="foreigner">Foreigner</option>
        </select>
      </label>
      {residency === "pr" ? (
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>PR granted on</span>
          <input className={ui.input} name="pr_granted_on" type="date" defaultValue={defaultPrGrantedOn} />
        </label>
      ) : null}
      {children}

      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>SHG fund</span>
        <select
          className={ui.select}
          name="shg_fund"
          value={shgFund}
          onChange={(event) => setShgFund(event.target.value)}
        >
          <option value="">Select</option>
          <option value="cdac">CDAC</option>
          <option value="ecf">ECF</option>
          <option value="mbmf">MBMF</option>
          <option value="sinda">SINDA</option>
          <option value="none">None / not set</option>
        </select>
      </label>
      {showShgDetails ? (
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>SHG mode</span>
          <select className={ui.select} name="shg_mode" value={shgMode} onChange={(event) => setShgMode(event.target.value)}>
            <option value="standard">Standard band</option>
            <option value="opt_out">Opt out</option>
            <option value="custom_amount">Custom amount</option>
          </select>
        </label>
      ) : (
        <input type="hidden" name="shg_mode" value="standard" />
      )}
      {showShgCustom ? (
        <label className="flex flex-col gap-1.5">
          <span className={ui.label}>Custom SHG amount</span>
          <input className={ui.input} name="shg_custom_amount_sgd" type="number" min="0" step="0.01" defaultValue={defaultShgCustomAmount} />
        </label>
      ) : null}
      {showShgProof ? (
        <label className="flex flex-col gap-1.5 md:col-span-2">
          <span className={ui.label}>SHG proof note</span>
          <textarea className={ui.input} name="shg_proof_note" rows={2} defaultValue={defaultShgProofNote} />
        </label>
      ) : null}
      {residency === "pr" ? (
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" name="cpf_full_rate_elected" defaultChecked={defaultCpfFullRate} />
          CPF full-rate election recorded
        </label>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ea_part4_overtime_covered" defaultChecked={defaultEaPart4} />
        Employment Act Part 4 overtime
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="is_workman" defaultChecked={defaultIsWorkman} />
        Workman (overtime cap $4,500)
      </label>
    </div>
  );
}
