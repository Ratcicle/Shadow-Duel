export interface ValidationIssue {
  cardId?: string | number;
  cardName?: string;
  effectIndex?: number | null;
  actionIndex?: number | null;
  message?: string;
}
export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}
interface ValidationPanelOptions {
  messagesEl: HTMLElement | null;
  validateCardDatabase: () => ValidationResult;
}
export function createValidationPanel({
  messagesEl,
  validateCardDatabase,
}: ValidationPanelOptions) {
  let latestValidationResult: ValidationResult | null = null;

  function run(options: { silent?: boolean } = {}) {
    const { silent = false } = options;
    latestValidationResult = validateCardDatabase();
    show(latestValidationResult);
    if (latestValidationResult.errors.length) {
      console.error(
        "Card database validation errors:",
        latestValidationResult.errors,
      );
      if (!silent) {
        alert(
          "Não é possível iniciar o duelo: há erros no banco de cartas. Verifique os detalhes acima.",
        );
      }
      return false;
    }
    if (latestValidationResult.warnings.length) {
      console.warn(
        "Card database validation warnings:",
        latestValidationResult.warnings,
      );
    }
    return true;
  }

  function show(result: ValidationResult | null) {
    if (!messagesEl || !result) return;
    const shouldShowErrors = Array.isArray(result.errors)
      ? result.errors.length > 0
      : false;
    const shouldShowWarnings = false;

    if (!shouldShowErrors && !shouldShowWarnings) {
      messagesEl.classList.add("hidden");
      messagesEl.innerHTML = "";
      return;
    }

    const messages = [];
    if (shouldShowErrors) {
      messages.push(
        `<strong>${result.errors.length} erro(s) na base de cartas.</strong>`,
      );
      messages.push(renderIssueList(result.errors, "error"));
    }
    if (shouldShowWarnings) {
      messages.push(
        `<strong>${result.warnings.length} aviso(s) encontrados.</strong>`,
      );
      messages.push(renderIssueList(result.warnings, "warning"));
    }

    messagesEl.innerHTML = messages.join("");
    messagesEl.classList.remove("hidden");
  }

  return {
    run,
    show,
    getLatestResult: () => latestValidationResult,
  };
}

function renderIssueList(issues: readonly ValidationIssue[], cssClass: string) {
  const MAX_ITEMS = 5;
  const listItems = issues
    .slice(0, MAX_ITEMS)
    .map(
      (issue) =>
        `<li class="${
          cssClass === "warning" ? "warning" : ""
        }">${formatIssueForDisplay(issue)}</li>`,
    );
  if (issues.length > MAX_ITEMS) {
    listItems.push(
      `<li class="${cssClass === "warning" ? "warning" : ""}">+ ${
        issues.length - MAX_ITEMS
      } mais...</li>`,
    );
  }
  return `<ul>${listItems.join("")}</ul>`;
}

function formatIssueForDisplay(issue: ValidationIssue) {
  const parts = [];
  if (typeof issue.cardId === "number") {
    parts.push(`ID ${issue.cardId}`);
  }
  if (issue.cardName) {
    parts.push(issue.cardName);
  }
  if (issue.effectIndex !== undefined && issue.effectIndex !== null) {
    parts.push(`Efeito ${issue.effectIndex}`);
  }
  if (issue.actionIndex !== undefined && issue.actionIndex !== null) {
    parts.push(`Ação ${issue.actionIndex}`);
  }
  const prefix = parts.length ? `[${parts.join(" | ")}] ` : "";
  return `${prefix}${issue.message || ""}`;
}

export type ValidationPanel = ReturnType<typeof createValidationPanel>;
