import type { SupportedLocale } from "../../core/i18n.js";
interface LocaleControls {
  buttons: readonly HTMLElement[];
  getLocale: () => SupportedLocale;
  setLocale: (locale: string) => unknown;
}
export function bindLocaleControls({
  buttons,
  getLocale,
  setLocale,
}: LocaleControls) {
  updateLocaleButtons({ buttons, getLocale });
  if (!buttons?.length) return;
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetLang = btn.dataset.lang;
      if (!targetLang || getLocale() === targetLang) {
        return;
      }
      setLocale(targetLang);
      location.reload();
    });
  });
}

function updateLocaleButtons({
  buttons,
  getLocale,
}: Pick<LocaleControls, "buttons" | "getLocale">) {
  if (!buttons?.length) return;
  const currentLang = getLocale();
  buttons.forEach((btn) => {
    const lang = btn.dataset.lang;
    const isActive = lang && lang === currentLang;
    btn.classList.toggle("active", Boolean(isActive));
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}
