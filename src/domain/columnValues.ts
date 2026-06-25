// Builders for Monday column_values payloads. Each returns the JSON-serializable
// value Monday expects for that column type. Compose them into one object keyed
// by column id and hand to monday.updateColumns().

export const cv = {
  /** status / color column — set by label. */
  status(label: string) {
    return { label };
  },
  /** dropdown column — set by one or more labels. */
  dropdown(labels: string[]) {
    return { labels };
  },
  /** date column. Pass time 'HH:mm:ss' for a datetime, omit for date-only. */
  date(date: string, time?: string) {
    return time ? { date, time } : { date };
  },
  /** long_text column. */
  longText(text: string) {
    return { text };
  },
  /** link column. */
  link(url: string, text?: string) {
    return { url, text: text ?? url };
  },
  /** checkbox column. Monday wants the string "true"; uncheck by setting null. */
  checkbox(checked: boolean) {
    return checked ? { checked: 'true' } : null;
  },
  /** numbers column. */
  number(n: number) {
    return String(n);
  },
};
