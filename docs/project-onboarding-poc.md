# Project onboarding POC

## Purpose

Project onboarding extends the organisation-wide compliance platform with learning grounded in the
documents of a specific project. The connector registry supports the local filesystem, read-only
GitHub repositories, and Confluence Cloud pages. Each project can contain multiple named resources
of every type without changing the course, assignment, assessment or reporting layers.

## Boundaries

- The configured source root is trusted configuration, not a user-supplied arbitrary path.
- Only regular UTF-8 Markdown and text files are ingested.
- Symlinks, traversal, oversized files, unsupported types and invalid UTF-8 are rejected or reported.
- Each document retains its relative path, byte size and SHA-256 hash.
- GitHub documents retain an immutable commit SHA and browser source URL; Confluence documents
  retain the page version and canonical page URL.
- Connector names come from an explicit registry; arbitrary dynamic imports are not allowed.
- Raw credentials are rejected. GitHub and Confluence access use environment-variable references.
- Generated courses remain drafts until a manager publishes them.
- Employees see only published courses assigned to them; answer keys are removed from delivery payloads.
- A completed non-project training activity is required before project training starts.
- Project-course results award XP and appear in activity history, but do not alter compliance-topic scores.

## Runtime flow

1. A manager opens `/projects` and adds one or more Local, GitHub, or Confluence resources.
2. Each connector can be tested and synchronized independently; project sync aggregates every
   enabled resource into a deterministic manifest from accepted document paths and hashes.
3. Course generation selects a bounded, stable set of source documents and produces cited lessons
   and knowledge-check questions.
4. The manager reviews and publishes the draft.
5. The manager assigns the published course to one or more employees.
6. An eligible employee starts the course, submits a complete answer set, and receives the existing
   performance label, XP and learning-history record.

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects?userId=...` | List managed or assigned projects |
| `GET` | `/api/project-connectors?userId=...` | List manager-visible connector metadata |
| `GET` | `/api/projects/{projectId}?userId=...` | Load project source, course and assignment state |
| `GET` | `/api/projects/{projectId}/sources?userId=...` | List the project's named resources |
| `POST` | `/api/projects/{projectId}/sources` | Add a named resource |
| `PUT` | `/api/projects/{projectId}/sources/{sourceId}` | Update a named resource |
| `DELETE` | `/api/projects/{projectId}/sources/{sourceId}?userId=...` | Remove a named resource |
| `POST` | `/api/projects/{projectId}/sources/{sourceId}/test` | Test a saved resource |
| `POST` | `/api/projects/{projectId}/sources/{sourceId}/sync` | Synchronize one saved resource |
| `PUT` | `/api/projects/{projectId}/source` | Validate and save manager-only source configuration |
| `POST` | `/api/projects/{projectId}/source/test` | Test a source without persisting it |
| `POST` | `/api/projects/{projectId}/sync` | Manager-only source synchronization |
| `POST` | `/api/projects/{projectId}/courses/generate` | Manager-only draft generation |
| `POST` | `/api/projects/{projectId}/courses/{courseId}/publish` | Manager-only publication |
| `POST` | `/api/projects/{projectId}/assignments` | Manager-only employee assignment |
| `POST` | `/api/projects/{projectId}/attempts` | Start or resume an assigned course |
| `POST` | `/api/projects/{projectId}/attempts/{attemptId}/submit` | Evaluate and record a complete answer set |

The POC uses the platform's seeded identity model. Production authentication and a managed secret
vault remain separate future work.

## Persistence

PostgreSQL stores projects, synchronized documents, versioned course drafts, assignments and project
attempts. Source content is snapshotted with its manifest so a course remains traceable to the exact
documents used during generation.

## Connector plugins

Connectors live under `backend/app/connectors/`. `base.py` defines the normalized contract,
`registry.py` is the allowlisted factory, and each connector owns its validation and retrieval
logic. Remote-connector packages are isolated in `backend/requirements-connectors-*.txt`.

GitHub configuration accepts `repository`, `ref`, `includePaths`, `excludePaths`, and an optional
`tokenEnvVar`. Repository URLs must use `https://github.com`; API calls are fixed to
`https://api.github.com`. Tokens are read only at request time and are never returned by the API.

Confluence configuration accepts a non-empty `pageUrls` list, optional `includeDescendants`, and
an optional `accountEmail`/`tokenEnvVar` pair. Page links must be Atlassian Cloud links under
`https://*.atlassian.net/wiki` and include `/pages/{numericId}`. All links in one resource must use
the same Atlassian site; add another resource for another site. API calls are rebuilt against that
validated host, redirects are not followed, attachments are ignored, and page count/size/pagination
are bounded. Public pages may omit credentials. Private pages read the API token only at request time.

## Local and container configuration

For a local backend, the default source works when the repository exists at
`~/inovaare_1/revamped_KB/docs`. Otherwise set an absolute path:

```bash
export PROJECT_DOCS_ROOT=/absolute/path/to/revamped_KB/docs
```

For Docker, mount the source read-only:

```bash
docker run --rm -p 8000:8000 \
  -v /absolute/path/to/revamped_KB/docs:/project-docs:ro \
  -e PROJECT_DOCS_ROOT=/project-docs \
  compliance-simulation-platform
```

For a private repository, export a read-only fine-grained token and enter only its variable name in
the project source editor:

```bash
export PROJECT_GITHUB_TOKEN='read-only-fine-grained-token'
```

For private Confluence Cloud pages, create an Atlassian API token and expose it separately from the
saved resource configuration:

```bash
export PROJECT_CONFLUENCE_TOKEN='atlassian-api-token'
```

In `/projects`, add a Confluence resource, paste one page link per line, optionally include
descendants, enter the Atlassian account email, and enter `PROJECT_CONFLUENCE_TOKEN` as the token
environment-variable name.

## Verification

```bash
conda env create -f environment.yml
conda run -n compliance-simulation-platform python -m pytest -q backend/tests
cd frontend && npm ci && npm run build
cd frontend && npx playwright install chromium && npm run test:e2e
```

The Playwright scenario covers the complete manager-to-employee lifecycle against a packaged
application and a real PostgreSQL database.
