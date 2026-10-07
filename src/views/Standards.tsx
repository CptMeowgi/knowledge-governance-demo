import { POLICY } from "../domain/policy";
import { TEMPLATES } from "../domain/templates";
import { useStore } from "../store/store";
import { PageHead } from "../ui/bits";
import { percent } from "../ui/format";

const ROLES: [string, string][] = [
  ["Anyone active", "Create drafts, edit drafts, and propose changes to published articles"],
  ["The author or the owner", "Submit content for review"],
  ["The assigned reviewer", "Approve or request changes, but never on a version they wrote"],
  ["The owner or the reviewer", "Recertify a published article as still accurate"],
  ["The owner, or a knowledge manager", "Retire an article, with a reason"],
  ["The section owner, or a knowledge manager", "Restore a retired article (as a draft)"],
  ["Article owner, section owner, or knowledge manager", "Change the owner, reviewer or review cycle"],
  ["People who have left", "Nothing. Anything they own is flagged as orphaned"],
];

const POLICY_ROWS: [string, string][] = [
  ["Review warning", `${POLICY.reviewDueSoonDays} days before an article's review date`],
  ["Review cycle limits", `Between ${POLICY.reviewIntervalDays.min} and ${POLICY.reviewIntervalDays.max} days`],
  ["Gap window", `The last ${POLICY.gapWindowDays} days of usage`],
  ["Unmet search", `At least ${POLICY.minFailedSearches} failed searches, and at least ${percent(POLICY.minSearchFailureRate)} of the group failing`],
  ["Grouping searches", `Keywords overlap by at least ${percent(POLICY.searchClusterSimilarity)}, after the glossary is applied`],
  ["Search results", `Must contain at least ${percent(POLICY.minQueryCoverage)} of the query's keywords`],
  ["Enough ratings to judge", `${POLICY.minRatings} or more`],
  ["Low helpfulness", `Under ${percent(POLICY.lowHelpfulRate)} rated helpful`],
  ["Busy article", `Top quarter of published articles by views, and at least ${POLICY.minViewsForHighTraffic} views`],
  ["Bar for busy articles", `Under ${percent(POLICY.highTrafficHelpfulRate)} rated helpful`],
  ["Dismissed gaps reopen", `When the evidence reaches ${POLICY.reopenDismissedAtMultiple}× what it was`],
  ["Dead content", `Published for over ${POLICY.deadContentDays} days with no views in that time`],
];

export function Standards() {
  const { kb } = useStore();
  return (
    <>
      <PageHead title="Standards">
        The rules content is held to. Templates fix each article's shape, the glossary fixes its wording, and the policy
        fixes every threshold the rest of the app applies. None of this is advisory: submission is blocked until the
        content complies.
      </PageHead>

      <section className="card">
        <h2 className="card__title">Templates</h2>
        <div className="templates">
          {Object.values(TEMPLATES).map((template) => (
            <article key={template.type} className="template">
              <h3>{template.label}</h3>
              <p className="muted">{template.purpose}</p>
              <p className="hint">Reviewed every {template.defaultReviewIntervalDays} days by default</p>
              <ul className="plain-list">
                {template.fields.map((field) => (
                  <li key={field.key}>
                    <strong>{field.label}</strong> {field.required ? <span className="required">required</span> : <span className="muted">optional</span>}
                    <br />
                    <span className="muted">{field.hint}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Glossary</h2>
        <p className="muted">
          One agreed term per concept. Using a term from the “avoid” column blocks submission, and search treats it as the
          agreed term, so people find the right article whatever word they use.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Agreed term</th>
                <th>Avoid</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {kb.glossary.map((term) => (
                <tr key={term.id}>
                  <td>
                    <strong>{term.preferred}</strong>
                  </td>
                  <td>{term.avoid.join(", ")}</td>
                  <td>{term.definition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Who can do what</h2>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {ROLES.map(([who, what]) => (
                <tr key={who}>
                  <th scope="row">{who}</th>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Policy thresholds</h2>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {POLICY_ROWS.map(([name, value]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
