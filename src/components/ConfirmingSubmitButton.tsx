"use client";

import { useFormStatus } from "react-dom";

type Props = {
  className: string;
  children: React.ReactNode;
  confirmMessage: string;
  pendingText?: string;
  disabled?: boolean;
};

export function ConfirmingSubmitButton({
  className,
  children,
  confirmMessage,
  pendingText = "Loading...",
  disabled = false,
}: Props) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={className}
      disabled={disabled || pending}
      onClick={(event) => {
        if (pending || disabled) return;
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      {pending ? pendingText : children}
    </button>
  );
}
