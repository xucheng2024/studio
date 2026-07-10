"use client";

import { useFormStatus } from "react-dom";

type Props = {
  className: string;
  children: React.ReactNode;
  confirmMessage: string;
  pendingText?: string;
  disabled?: boolean;
  formAction?: (formData: FormData) => void | Promise<void>;
};

export function ConfirmingSubmitButton({
  className,
  children,
  confirmMessage,
  pendingText = "Loading...",
  disabled = false,
  formAction,
}: Props) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      formAction={formAction}
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
