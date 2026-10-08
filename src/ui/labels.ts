import type { FeedbackReason, RetirementReason } from "../domain/types";

export const FEEDBACK_REASONS: Record<FeedbackReason, string> = {
  out_of_date: "Out of date",
  missing_steps: "Missing steps",
  incorrect: "Incorrect",
  hard_to_follow: "Hard to follow",
};

export const RETIREMENT_REASONS: Record<RetirementReason, string> = {
  obsolete: "Obsolete: no longer applies",
  superseded: "Superseded by another article",
  duplicate: "Duplicate of another article",
};
