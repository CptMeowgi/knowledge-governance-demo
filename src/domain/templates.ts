import type { ArticleType, Body } from "./types";

export interface TemplateField {
  key: string;
  label: string;
  required: boolean;
  hint: string;
}

export interface Template {
  type: ArticleType;
  label: string;
  purpose: string;
  fields: TemplateField[];
  /** Content that changes faster is reviewed more often. */
  defaultReviewIntervalDays: number;
}

/** Content standards: every article type has a fixed shape. */
export const TEMPLATES: Record<ArticleType, Template> = {
  "how-to": {
    type: "how-to",
    label: "How-to",
    purpose: "Walks the reader through completing a task.",
    defaultReviewIntervalDays: 180,
    fields: [
      { key: "goal", label: "Goal", required: true, hint: "What the reader will have done when they finish." },
      { key: "before", label: "Before you start", required: false, hint: "Access, tools or information needed first." },
      { key: "steps", label: "Steps", required: true, hint: "Numbered, one action per step." },
      { key: "result", label: "Expected result", required: true, hint: "How the reader knows it worked." },
    ],
  },
  troubleshooting: {
    type: "troubleshooting",
    label: "Troubleshooting",
    purpose: "Gets the reader from a symptom to a fix.",
    defaultReviewIntervalDays: 90,
    fields: [
      { key: "symptom", label: "Symptom", required: true, hint: "What the reader sees, in their words." },
      { key: "cause", label: "Cause", required: true, hint: "Why it happens." },
      { key: "resolution", label: "Resolution", required: true, hint: "Steps that fix it." },
      { key: "escalation", label: "When to escalate", required: true, hint: "When to stop and who to contact." },
    ],
  },
  reference: {
    type: "reference",
    label: "Reference",
    purpose: "Facts the reader looks up rather than follows.",
    defaultReviewIntervalDays: 365,
    fields: [
      { key: "summary", label: "Summary", required: true, hint: "The answer in two sentences." },
      { key: "details", label: "Details", required: true, hint: "The full reference content." },
      { key: "related", label: "Related", required: false, hint: "Other articles worth reading next." },
    ],
  },
};

export function emptyBody(type: ArticleType): Body {
  return Object.fromEntries(TEMPLATES[type].fields.map((field) => [field.key, ""]));
}

export function missingRequiredFields(type: ArticleType, body: Body): TemplateField[] {
  return TEMPLATES[type].fields.filter((field) => field.required && !body[field.key]?.trim());
}
