/**
 * Every governance threshold in one place. Changing the policy means changing
 * this file, not hunting through the logic that uses it.
 */
export const POLICY = {
  /** A published article is "due soon" this many days before its review date. */
  reviewDueSoonDays: 14,
  /** Owners can set a review interval within these limits. */
  reviewIntervalDays: { min: 30, max: 730 },

  /** Gaps and most report figures look back this many days. */
  gapWindowDays: 30,

  /** A group of similar searches needs at least this many failures to count as a gap... */
  minFailedSearches: 3,
  /** ...and at least this share of the group must have failed. */
  minSearchFailureRate: 0.5,
  /** Two searches belong to the same group when their keywords overlap at least this much. */
  searchClusterSimilarity: 0.5,
  /** Search results must contain at least this share of the query's keywords. */
  minQueryCoverage: 0.5,

  /** Below this many ratings, a helpful rate is treated as unknown rather than low. */
  minRatings: 5,
  /** An article rated helpful less often than this is a gap whatever its traffic. */
  lowHelpfulRate: 0.6,
  /** A high-traffic article is held to a higher bar. */
  highTrafficHelpfulRate: 0.7,
  /** "High traffic" means views in this quantile of published articles or above... */
  highTrafficQuantile: 0.75,
  /** ...and never fewer than this many views. */
  minViewsForHighTraffic: 20,

  /** A dismissed gap reopens once its evidence reaches this multiple of what it was. */
  reopenDismissedAtMultiple: 2,

  /** Published for longer than this with no views in this period counts as dead content. */
  deadContentDays: 90,
  /** Reuse concentration reports the share of views served by this top share of articles. */
  reuseTopShare: 0.2,
} as const;
