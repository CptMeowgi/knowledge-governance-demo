# Knowledge Base 2.0: governance design

This is the agreed model. Every rule below is implemented in `src/domain/` and
pinned down by the tests that sit next to each module. If this document and the
tests ever disagree, the tests win and this document gets fixed.

## The problem

A knowledge base fails quietly. Articles go out of date and nobody notices.
The person who wrote them leaves and nobody inherits them. People search for
something that isn't there and give up, and that failure leaves no trace. The
result is a library that looks full but can't be trusted.

This model makes those failures visible and makes the controls that prevent
them impossible to skip.

## Four rules everything else follows

1. **Lifecycle state is enforced, not set.** Nothing writes `state` directly.
   The only way to change an article is `transition(article, action, context)`,
   which either applies the change or returns the reasons it was refused.
2. **Stale is a condition, not a state.** An article past its review date is
   often still the best answer available. It stays published and is flagged.
   Taking it offline would turn a quality problem into a gap.
3. **Ownership belongs to people, and it decays.** When someone leaves
   (`active: false`), everything they own is flagged as orphaned automatically.
4. **Gaps are derived from usage, never entered by hand.** Searches, views and
   feedback are an append-only log. Gaps are calculated from that log. The only
   thing stored about a gap is how it's being handled.

## People and roles

There are no accounts. A "Viewing as" switcher picks one of the invented
people, so every rule can be tried from every side. People who have left can't
take any action.

| Who | Can |
|---|---|
| Any active person | Create drafts, edit drafts, propose a revision to published content |
| Author of the content in question, or the article owner | Submit it for review |
| The assigned reviewer | Approve, or request changes (never on content they wrote) |
| Owner or reviewer | Recertify a published article |
| Owner, or a knowledge manager | Retire an article |
| Section owner, or a knowledge manager | Restore a retired article |
| Article owner, section owner, or a knowledge manager | Change owner, reviewer or review interval |

The **knowledge manager** runs the framework rather than the content. They can
fix ownership anywhere, which is what stops an orphaned article staying
orphaned when its section owner has also left. They can't approve content
unless they're its assigned reviewer.

"Author" always means *whoever last changed the content now in question*. If a
reviewer edits a draft, they become its author and can no longer approve it.

## Lifecycle

```
           submit                 approve                 retire
  Draft ──────────▶ In Review ──────────▶ Published ──────────▶ Retired
    ▲                  │                   │  ▲                   │
    └─ request changes ┘                   └──┘ recertify         │
    ▲                                                             │
    └──────────────────────────── restore ────────────────────────┘
```

| Action | Transition | Guards (all must pass) |
|---|---|---|
| edit | draft → draft | Not in review; not retired |
| submit | draft → in review | Title present; every required template field filled; no glossary violations; active owner; active reviewer; reviewer isn't the author |
| request changes | in review → draft | Assigned reviewer only; a note saying what to change |
| approve | in review → published | Assigned reviewer only; reviewer isn't the author; owner still active. Starts the review clock |
| recertify | published → published | Owner or reviewer. Confirms the content is still accurate and restarts the review clock |
| retire | published → retired | Owner or knowledge manager; a reason; "superseded" must name a published replacement; no pending revision |
| restore | retired → draft | Section owner or knowledge manager. Goes back through review, never straight to published |
| assign | no state change | See roles above. New owner and reviewer must be active; interval within policy limits |

**Content in review is frozen.** Nobody can edit it, so the reviewer approves
exactly what they read.

### Editing published content: revisions

Changing a published article doesn't take it offline. The change becomes a
**pending revision** with its own small lifecycle (draft → in review). The
published text stays live while that happens. Approving the revision replaces
the live content and restarts the review clock. Only one revision can be
pending at a time. A revision can be discarded by its author, the owner or a
knowledge manager.

Submit, request changes and approve work the same way on a revision as on a new
article. They always act on the *working copy*: the article itself while it's
a draft or in review, or its pending revision once it's published.

## Review and recertification

Every article has a review interval. Defaults come from its template:
troubleshooting 90 days, how-to 180, reference 365. The owner can change it
within policy limits.

Review status applies to published articles only:

| Status | Meaning |
|---|---|
| current | Next review is more than 14 days away |
| due soon | Next review is within 14 days |
| overdue | Past its review date. Counts as **stale** |

Overdue articles stay searchable and are labelled "Review overdue" in results.

## Ownership health

An article that isn't retired is flagged if its owner or reviewer is missing,
or has left. A section is flagged if it has no active owner.

## Content standards

**Templates.** Article bodies are structured fields, not free text. Each type
has its own required fields:

| Type | Fields (* = required) |
|---|---|
| How-to | Goal*, Before you start, Steps*, Expected result* |
| Troubleshooting | Symptom*, Cause*, Resolution*, When to escalate* |
| Reference | Summary*, Details*, Related |

**Glossary.** One agreed term per concept, each with a list of terms to avoid.
Using an avoided term **blocks submission**. Search maps avoided terms to the
agreed one, so a search for "login" finds articles written with "sign in".

That's also why this structure matters for AI retrieval. Owned, dated,
consistently worded content in predictable fields is what lets retrieval return
the right passage and lets anyone judge whether to trust it.

## Gap detection

Gaps are ranked by one common unit, **estimated people failed in the last 30
days**, and every gap shows the evidence behind it.

| Signal | Counts as a gap when | People failed |
|---|---|---|
| Unmet search | A group of similar searches has at least 3 failures, and at least half the group failed. A search fails if it returned nothing or nothing was clicked | Number of failed searches |
| Low helpfulness | A published article has at least 5 ratings and fewer than 60% helpful | Estimated readers failed (see below) |
| High traffic, poor outcome | Views in the top quartile, and fewer than 70% helpful (at least 5 ratings) | Estimated readers failed |
| High traffic, overdue | Views in the top quartile, and review overdue | Estimated readers failed, which is 0 if it isn't rated yet |

*Estimated readers failed* = views × (1 − helpful rate), and never less than the
number of explicit "not helpful" ratings. An overdue article with no ratings
yet is listed, but ranked by evidence of failure. Risk alone puts it at the
bottom of the list.

**Grouping searches.** Queries are lowercased, stripped of punctuation, mapped
through the glossary and reduced to keywords. They're grouped when their
keywords overlap by at least half. The most frequent phrasing labels the group,
so labels use the words people actually typed.

**Handling a gap.**

| Action | Effect |
|---|---|
| Start work | Assigned to someone (the section owner by default) and optionally linked to an article. The status becomes *in progress* |
| Create draft from gap | Starts work and links a new draft with the title pre-filled |
| Resolved | Calculated: the linked article has been **approved after work started** |
| Dismiss | Requires a reason. A dismissed gap **reopens on its own** if its evidence doubles |

## Reporting

All calculated, none entered:

- Search success rate, last 30 days
- Stale: overdue share of published articles
- Ownership gaps: articles and sections without active ownership
- Overall helpful rate, last 30 days
- Dead content: published for over 90 days with no views in 90 days
- Reuse concentration: share of views served by the top 20% of articles
- Pipeline: articles in each state, revisions in review, oldest item waiting in review

## Policy

Every threshold lives in `src/domain/policy.ts`. Changing the policy means
changing one file, not hunting through logic.

## Data and storage

- Seed data is invented and uses **relative dates** ("45 days ago"), which are
  turned into real dates on first load. Without that, the demo would go stale
  a few months after launch, which is the very problem it's meant to show.
- State lives in `localStorage`. Every read and write is wrapped so the app
  falls back to in-memory state if storage isn't available. "Reset demo data"
  restores the seed.

## Deliberately out of scope

Accounts, authentication, a backend, a database, multi-tenancy and AI chat
features. They add risk and prove nothing about governance.
