import { createStudio } from "@/app/(app)/dashboard/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ServerActionToastForm } from "@/components/dashboard/ServerActionToastForm";
import { ui } from "@/lib/ui";

export function CreateStudioForm() {
  return (
    <ServerActionToastForm action={createStudio} className={`${ui.card} mt-8 flex flex-col gap-4`}>
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>Studio name</span>
        <input
          name="name"
          required
          className={ui.input}
          placeholder="Downtown Gym"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={ui.label}>Public URL slug</span>
        <input
          name="public_slug"
          required
          minLength={3}
          maxLength={60}
          pattern="[a-zA-Z0-9\\-]+"
          placeholder="downtown-gym"
          title="Letters, numbers, hyphens only"
          className={`${ui.input} font-mono text-sm`}
        />
      </label>
      <p className={`text-xs ${ui.muted}`}>
        Live at <code className={ui.code}>/your-slug</code> - stored lowercase.
      </p>
      <SubmitButton className={`${ui.btnPrimary} w-full sm:w-auto`} pendingText="Saving...">
        Save studio
      </SubmitButton>
    </ServerActionToastForm>
  );
}
