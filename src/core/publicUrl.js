function getPublicBaseUrl() {
  const configuredBase = import.meta.env?.BASE_URL || "/";
  const normalizedBase = String(configuredBase).trim();

  if (!normalizedBase || normalizedBase === "/") return "/";

  return `/${normalizedBase.replace(/^\/+|\/+$/g, "")}/`;
}

export function publicUrl(path) {
  const value = String(path || "").trim();
  if (!value) return "";

  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) {
    return value;
  }

  return `${getPublicBaseUrl()}${value.replace(/^\/+/, "")}`;
}

export const publicAssetUrl = publicUrl;
