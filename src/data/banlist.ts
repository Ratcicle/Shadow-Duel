export const BANLIST_STATUS = Object.freeze({
  FORBIDDEN: "forbidden",
  LIMITED: "limited",
  SEMI_LIMITED: "semi_limited",
  UNLIMITED: "unlimited",
});

// Code-only source of truth. Cards omitted from this object are unlimited.
export const CURRENT_BANLIST = Object.freeze({
  8: BANLIST_STATUS.LIMITED,
} satisfies Partial<Record<
  number,
  (typeof BANLIST_STATUS)[keyof typeof BANLIST_STATUS]
>>);
