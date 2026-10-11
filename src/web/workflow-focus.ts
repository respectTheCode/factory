/** Focus the newly revealed control and bring it into view without changing work. */
export function focusWorkflowControl(
  control: Pick<HTMLElement, "focus" | "scrollIntoView"> | null | undefined,
) {
  control?.focus();
  control?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function focusFinishRuleEditor(
  editor: Pick<HTMLElement, "querySelectorAll" | "querySelector"> | null,
  pullRequestUrl?: string,
) {
  const checkbox = pullRequestUrl
    ? Array.from(
        editor?.querySelectorAll<HTMLInputElement>("input[data-pr-url]") ?? [],
      ).find((input) => input.dataset.prUrl === pullRequestUrl)
    : undefined;
  focusWorkflowControl(
    checkbox ?? editor?.querySelector<HTMLElement>("legend"),
  );
}
