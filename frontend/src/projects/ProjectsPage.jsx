import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpenCheck,
  Check,
  CheckCircle2,
  CircleAlert,
  Cloud,
  Clock3,
  FileText,
  FolderKanban,
  GitBranch,
  HardDrive,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Send,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { api } from '../api';

const asArray = (value) => (Array.isArray(value) ? value : []);
const titleCase = (value = '') => String(value).replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const unwrapProject = (payload) => payload?.project || payload?.data?.project || payload?.data || payload;
const projectList = (payload) => asArray(payload?.projects || payload?.items || payload?.data || payload);
const courseList = (project) => asArray(project?.courses || (project?.course ? [project.course] : []));
const documentList = (project) => asArray(project?.sourceDocuments || project?.documents || project?.source?.documents);
const defaultConnectors = [
  { type: 'local', label: 'Local project folder' },
  { type: 'github', label: 'GitHub repository' },
  { type: 'confluence', label: 'Confluence pages' },
];

function connectorList(payload) {
  const raw = asArray(payload?.connectors || payload?.data?.connectors || payload?.items || payload?.data || payload);
  const available = raw.map((entry) => {
    if (typeof entry === 'string') return { type: entry, label: titleCase(entry) };
    return {
      ...entry,
      type: String(entry?.type || entry?.connectorType || entry?.id || '').toLowerCase(),
      label: entry?.label || entry?.name || titleCase(entry?.type || entry?.connectorType || entry?.id),
    };
  }).filter((entry) => ['local', 'github', 'confluence'].includes(entry.type));

  return defaultConnectors.map((fallback) => available.find((entry) => entry.type === fallback.type) || fallback);
}

function sourceList(payload) {
  return asArray(payload?.sources || payload?.data?.sources || payload?.items || payload?.data || payload);
}

function sourceId(source) {
  return source?.id || source?.sourceId;
}

function sourceDraft(source) {
  const config = source?.config || source?.sourceConfig || {};
  return {
    id: sourceId(source) || '',
    name: source?.name || '',
    connectorType: String(source?.connectorType || source?.sourceType || source?.type || 'local').toLowerCase(),
    config: {
      sourceSubpath: config?.sourceSubpath ?? '.',
      repository: config?.repository ?? '',
      ref: config?.ref ?? 'main',
      includePaths: pathLines(config?.includePaths),
      excludePaths: pathLines(config?.excludePaths),
      pageUrls: pathLines(config?.pageUrls),
      includeDescendants: Boolean(config?.includeDescendants),
      accountEmail: config?.accountEmail ?? '',
      tokenEnvVar: config?.tokenEnvVar ?? '',
    },
  };
}

function pathLines(value) {
  return Array.isArray(value) ? value.join('\n') : String(value || '');
}

function parsePathLines(value) {
  return String(value).split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean);
}

function parseLines(value) {
  return String(value).split(/\n/).map((entry) => entry.trim()).filter(Boolean);
}

function invalidRelativePath(value, allowGlobs = false) {
  const normalized = String(value).trim().replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) return true;
  if (normalized.split('/').includes('..')) return true;
  return !allowGlobs && /[*?\[\]{}]/.test(normalized);
}

function confluenceUrlHost(value) {
  try {
    const url = new URL(value);
    const valid = url.protocol === 'https:'
      && url.hostname.endsWith('.atlassian.net')
      && url.hostname !== '.atlassian.net'
      && (!url.port || url.port === '443')
      && !url.username && !url.password && !url.search && !url.hash
      && (url.pathname === '/wiki' || url.pathname.startsWith('/wiki/'))
      && /\/pages\/\d+(?:\/|$)/.test(url.pathname);
    return valid ? url.hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

function validGitHubRepository(value) {
  const repository = String(value).trim();
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(repository)) return true;
  try {
    const url = new URL(repository);
    const parts = url.pathname.split('/').filter(Boolean);
    return url.protocol === 'https:'
      && ['github.com', 'www.github.com'].includes(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash
      && parts.length === 2
      && /^[A-Za-z0-9_.-]+$/.test(parts[0])
      && /^[A-Za-z0-9_.-]+(?:\.git)?$/.test(parts[1]);
  } catch {
    return false;
  }
}

function connectorIcon(type, size = 16) {
  if (type === 'github') return <GitBranch size={size} />;
  if (type === 'confluence') return <Cloud size={size} />;
  return <HardDrive size={size} />;
}

function projectName(project) {
  return project?.name || project?.title || 'Untitled project';
}

function courseStatus(course) {
  return String(course?.status || course?.lifecycleStatus || (course?.published ? 'published' : 'draft')).toLowerCase();
}

function getQuestions(attempt, course) {
  const direct = attempt?.questions
    || attempt?.assessment?.questions
    || attempt?.courseContent?.test?.questions
    || course?.questions
    || course?.quiz?.questions
    || course?.content?.test?.questions;
  if (Array.isArray(direct)) return direct;
  return asArray(course?.modules || course?.lessons).flatMap((module) => asArray(module.questions || module.quiz?.questions));
}

function getLessons(attempt, course) {
  return asArray(attempt?.courseContent?.lessons || course?.content?.lessons || course?.lessons || course?.modules);
}

function questionId(question, index) {
  return String(question?.id || question?.questionId || `question-${index + 1}`);
}

function optionValue(option, index) {
  if (typeof option === 'string') return option;
  return String(option?.id || option?.value || option?.optionId || index);
}

function optionLabel(option) {
  if (typeof option === 'string') return option;
  return option?.label || option?.text || option?.answer || option?.value || 'Answer option';
}

export default function ProjectsPage({ user, onNotify }) {
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  const loadProjects = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.listProjects(user.id);
      setProjects(projectList(response));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadProject = async (projectId, quiet = false) => {
    if (!quiet) setDetailLoading(true);
    setError('');
    try {
      const response = await api.getProject(projectId, user.id);
      const nextProject = unwrapProject(response);
      setProject(nextProject);
      setProjects((current) => current.map((entry) => (entry.id === nextProject?.id ? { ...entry, ...nextProject } : entry)));
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, [user.id]);

  useEffect(() => {
    if (!selectedId) {
      setProject(null);
      return;
    }
    loadProject(selectedId);
  }, [selectedId, user.id]);

  const handleChanged = async (message) => {
    await Promise.all([loadProject(selectedId, true), loadProjects()]);
    onNotify?.(message);
  };

  if (loading && !projects.length) return <ProjectLoading label="Loading projects" />;

  if (selectedId) {
    return (
      <div className="projects-page">
        <button className="project-back" type="button" onClick={() => setSelectedId('')}>
          <ArrowLeft size={16} /> All projects
        </button>
        {error && <ProjectError message={error} />}
        {detailLoading || !project ? (
          <ProjectLoading label="Loading project workspace" />
        ) : (
          <ProjectDetail project={project} user={user} onChanged={handleChanged} onError={setError} />
        )}
      </div>
    );
  }

  return (
    <div className="projects-page">
      <section className="projects-hero">
        <div className="projects-hero-icon"><FolderKanban size={25} /></div>
        <div>
          <span className="eyebrow">PROJECT-GROUNDED LEARNING</span>
          <h2>{user.isManager ? 'Turn project sources into focused training.' : 'Learn in the context of your work.'}</h2>
          <p>
            {user.isManager
              ? 'Sync approved source documents, generate a course, and assign it to the people doing the work.'
              : 'Complete concise courses grounded in the documents and decisions that matter to your projects.'}
          </p>
        </div>
        <button className="outline projects-refresh" type="button" onClick={loadProjects}>
          <RefreshCcw size={15} /> Refresh
        </button>
      </section>

      {error && <ProjectError message={error} />}
      <div className="projects-section-heading">
        <div>
          <span className="eyebrow">{user.isManager ? 'MANAGED PROJECTS' : 'MY PROJECTS'}</span>
          <h3>{projects.length} project{projects.length === 1 ? '' : 's'} available</h3>
        </div>
      </div>

      {projects.length ? (
        <div className="project-grid">
          {projects.map((entry) => (
            <ProjectCard key={entry.id} project={entry} onOpen={() => setSelectedId(entry.id)} />
          ))}
        </div>
      ) : (
        <div className="project-empty card">
          <FolderKanban size={28} />
          <h3>No projects yet</h3>
          <p>{user.isManager ? 'Projects will appear here when they are connected to your team.' : 'Your assigned project courses will appear here.'}</p>
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, onOpen }) {
  const courses = courseList(project);
  const sync = project.syncStatus || project.sourceSync?.status || project.source?.status || (project.lastSyncedAt ? 'synced' : 'not synced');
  const assignmentCount = project.assignmentCount ?? asArray(project.assignments).length;
  const documentCount = project.documentCount ?? documentList(project).length;
  const courseCount = courses.length || ((project.draftCourseCount || 0) + (project.publishedCourseCount || 0));

  return (
    <button className="project-card card" data-testid="project-card" type="button" onClick={onOpen}>
      <div className="project-card-top">
        <span className="project-folder"><FolderKanban size={20} /></span>
        <StatusPill value={sync} />
      </div>
      <div>
        <h3>{projectName(project)}</h3>
        <p>{project.description || project.summary || 'Project-specific learning workspace'}</p>
      </div>
      <div className="project-card-meta">
        <span><FileText size={14} /> {documentCount} sources</span>
        <span><BookOpenCheck size={14} /> {courseCount} course{courseCount === 1 ? '' : 's'}</span>
        <span><Users size={14} /> {project.assignmentStatus ? titleCase(project.assignmentStatus) : `${assignmentCount} assigned`}</span>
      </div>
      <span className="project-open">Open project <span aria-hidden="true">→</span></span>
    </button>
  );
}

function ProjectDetail({ project, user, onChanged, onError }) {
  const [busy, setBusy] = useState('');
  const [attempt, setAttempt] = useState(null);
  const [answers, setAnswers] = useState({});
  const [report, setReport] = useState(null);
  const courses = courseList(project);
  const activeCourse = courses.find((course) => courseStatus(course) === 'published') || courses[0];

  const act = async (key, task, successMessage) => {
    setBusy(key);
    onError('');
    try {
      await task();
      await onChanged(successMessage);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy('');
    }
  };

  const startCourse = async () => {
    setBusy('start');
    onError('');
    setReport(null);
    try {
      const response = await api.startProjectAttempt(project.id, user.id);
      setAttempt(response?.attempt || response?.data?.attempt || response);
      setAnswers({});
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy('');
    }
  };

  const submitAttempt = async () => {
    const attemptId = attempt?.id || attempt?.attemptId;
    if (!attemptId) return;
    setBusy('submit');
    onError('');
    try {
      const response = await api.submitProjectAttempt(project.id, attemptId, user.id, answers);
      setReport(response?.report || response?.result || response?.data?.report || response);
      setAttempt(null);
      await onChanged('Course submitted. Your learning report is ready.');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <section className="project-detail-hero card">
        <div>
          <span className="eyebrow">PROJECT WORKSPACE</span>
          <h2>{projectName(project)}</h2>
          <p>{project.description || project.summary || 'Learning grounded in this project’s approved source material.'}</p>
        </div>
        <StatusPill value={project.status || (user.isManager ? 'managed' : 'assigned')} />
      </section>

      <div className="project-detail-grid">
        <SourcePanel
          project={project}
          manager={user.isManager}
          busy={busy}
          onSync={() => act('sync', () => api.syncProject(project.id, user.id), 'Project sources synced.')}
        />
        <CoursePanel
          project={project}
          courses={courses}
          manager={user.isManager}
          busy={busy}
          onGenerate={() => act('generate', () => api.generateProjectCourse(project.id, user.id), 'Draft course generated.')}
          onPublish={(courseId) => act(`publish-${courseId}`, () => api.publishProjectCourse(project.id, courseId, user.id), 'Course published and ready to assign.')}
        />
      </div>

      {user.isManager && (
        <SourceResourcesPanel
          project={project}
          user={user}
          onChanged={onChanged}
        />
      )}

      {user.isManager ? (
        <AssignmentPanel project={project} user={user} busy={busy} setBusy={setBusy} onChanged={onChanged} onError={onError} />
      ) : (
        <LearnerPanel
          project={project}
          course={activeCourse}
          attempt={attempt}
          answers={answers}
          report={report || project.latestReport || project.report}
          busy={busy}
          onStart={startCourse}
          onAnswer={(id, value) => setAnswers((current) => ({ ...current, [id]: value }))}
          onSubmit={submitAttempt}
        />
      )}
    </>
  );
}

function SourceResourcesPanel({ project, user, onChanged }) {
  const [sources, setSources] = useState(() => asArray(project.sources));
  const [connectors, setConnectors] = useState(defaultConnectors);
  const [editor, setEditor] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState(null);

  const loadSources = async () => {
    const response = await api.getProjectSources(project.id, user.id);
    const nextSources = sourceList(response);
    setSources(nextSources);
    return nextSources;
  };

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      api.getProjectSources(project.id, user.id),
      api.getProjectConnectors(user.id),
    ]).then(([sourceResult, connectorResult]) => {
      if (!active) return;
      if (sourceResult.status === 'fulfilled') {
        setSources(sourceList(sourceResult.value));
      } else {
        setFeedback({ kind: 'error', message: sourceResult.reason?.message || 'Resources could not be loaded.' });
      }
      if (connectorResult.status === 'fulfilled') {
        setConnectors(connectorList(connectorResult.value));
      } else if (sourceResult.status === 'fulfilled') {
        setFeedback({ kind: 'error', message: connectorResult.reason?.message || 'Connector options could not be loaded.' });
      }
    });
    return () => { active = false; };
  }, [project.id, user.id]);

  const openEditor = (source = null) => {
    setEditor(sourceDraft(source));
    setValidationErrors({});
    setFeedback(null);
  };

  const updateEditor = (key, value) => {
    setEditor((current) => ({ ...current, [key]: value }));
    setValidationErrors((current) => ({ ...current, [key]: '' }));
    setFeedback(null);
  };

  const updateConfig = (key, value) => {
    setEditor((current) => ({ ...current, config: { ...current.config, [key]: value } }));
    setValidationErrors((current) => ({ ...current, [key]: '' }));
    setFeedback(null);
  };

  const validate = () => {
    const errors = {};
    const { connectorType, config } = editor;
    if (!editor.name.trim()) errors.name = 'Resource name is required.';
    if (connectorType === 'local') {
      if (invalidRelativePath(config.sourceSubpath)) {
        errors.sourceSubpath = 'Enter a relative folder path without parent traversal or wildcards.';
      }
    }
    if (connectorType === 'github') {
      const repository = config.repository.trim();
      if (!repository) {
        errors.repository = 'Repository is required.';
      } else if (!validGitHubRepository(repository)) {
        errors.repository = 'Use owner/repository or a github.com HTTPS URL without credentials.';
      }
      if (!config.ref.trim()) errors.ref = 'Branch, tag, or commit is required.';
      for (const [key, values] of [['includePaths', parsePathLines(config.includePaths)], ['excludePaths', parsePathLines(config.excludePaths)]]) {
        if (values.some((value) => invalidRelativePath(value, true))) {
          errors[key] = 'Use relative repository paths; parent traversal is not allowed.';
        }
      }
    }
    if (connectorType === 'confluence') {
      const pageUrls = parseLines(config.pageUrls);
      if (!pageUrls.length) {
        errors.pageUrls = 'Add at least one Confluence page URL.';
      } else if (pageUrls.length > 500) {
        errors.pageUrls = 'A Confluence resource can contain at most 500 page URLs.';
      } else {
        const hosts = pageUrls.map(confluenceUrlHost);
        if (hosts.some((host) => !host)) {
          errors.pageUrls = 'Use Atlassian Cloud page links under https://*.atlassian.net/wiki without credentials or parameters.';
        } else if (new Set(hosts).size > 1) {
          errors.pageUrls = 'Use one Atlassian site per resource; add another resource for a different site.';
        }
      }
      if (config.accountEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.accountEmail.trim())) {
        errors.accountEmail = 'Enter a valid account email address.';
      }
      const hasEmail = Boolean(config.accountEmail.trim());
      const hasTokenReference = Boolean(config.tokenEnvVar.trim());
      if (hasEmail !== hasTokenReference) {
        if (!hasEmail) errors.accountEmail = 'Account email is required when using a token variable.';
        if (!hasTokenReference) errors.tokenEnvVar = 'Token environment variable is required with an account email.';
      }
    }
    if (config.tokenEnvVar.trim() && !/^[A-Z_][A-Z0-9_]*$/.test(config.tokenEnvVar.trim())) {
      errors.tokenEnvVar = 'Use an uppercase environment variable name. Never enter the token itself.';
    } else if (connectorType === 'confluence' && config.tokenEnvVar.trim() && !/^(?:CONFLUENCE|PROJECT_CONFLUENCE)_[A-Z0-9_]+$/.test(config.tokenEnvVar.trim())) {
      errors.tokenEnvVar = 'Use a CONFLUENCE_ or PROJECT_CONFLUENCE_ environment variable name.';
    }
    setValidationErrors(errors);
    return !Object.keys(errors).length;
  };

  const editorPayload = () => {
    const { connectorType, config } = editor;
    let nextConfig;
    if (connectorType === 'local') {
      nextConfig = { sourceSubpath: config.sourceSubpath.trim() };
    } else if (connectorType === 'github') {
      nextConfig = {
        repository: config.repository.trim(),
        ref: config.ref.trim(),
        includePaths: parsePathLines(config.includePaths),
        excludePaths: parsePathLines(config.excludePaths),
        ...(config.tokenEnvVar.trim() ? { tokenEnvVar: config.tokenEnvVar.trim() } : {}),
      };
    } else {
      nextConfig = {
        pageUrls: parseLines(config.pageUrls),
        includeDescendants: Boolean(config.includeDescendants),
        ...(config.accountEmail.trim() ? { accountEmail: config.accountEmail.trim() } : {}),
        ...(config.tokenEnvVar.trim() ? { tokenEnvVar: config.tokenEnvVar.trim() } : {}),
      };
    }
    return { userId: user.id, name: editor.name.trim(), connectorType, config: nextConfig };
  };

  const saveSource = async (event) => {
    event.preventDefault();
    if (!validate()) {
      setFeedback({ kind: 'error', message: 'Review the highlighted resource settings.' });
      return;
    }
    setBusy('save');
    setFeedback(null);
    try {
      if (editor.id) {
        await api.updateProjectResource(project.id, editor.id, editorPayload());
      } else {
        await api.createProjectSource(project.id, editorPayload());
      }
      setEditor(null);
      await Promise.all([loadSources(), onChanged(editor.id ? 'Project resource updated.' : 'Project resource added.')]);
      setFeedback({ kind: 'success', message: editor.id ? 'Resource updated.' : 'Resource added.' });
    } catch (err) {
      setFeedback({ kind: 'error', message: err.message });
    } finally {
      setBusy('');
    }
  };

  const runSourceAction = async (mode, source) => {
    const id = sourceId(source);
    if (!id) return;
    if (mode === 'delete' && !window.confirm(`Delete “${source.name}”? This removes the resource configuration from the project.`)) return;
    setBusy(`${mode}-${id}`);
    setFeedback(null);
    try {
      let response;
      if (mode === 'test') response = await api.testProjectResource(project.id, id, user.id);
      if (mode === 'sync') response = await api.syncProjectResource(project.id, id, user.id);
      if (mode === 'delete') response = await api.deleteProjectSource(project.id, id, user.id);
      if (response?.ok === false || response?.reachable === false) {
        throw new Error(response.message || 'The resource connection could not be established.');
      }
      if (mode !== 'test') {
        await Promise.all([loadSources(), onChanged(mode === 'sync' ? `${source.name} synced.` : `${source.name} deleted.`)]);
      }
      const messages = { test: 'Connection successful.', sync: 'Resource synced.', delete: 'Resource deleted.' };
      setFeedback({ kind: 'success', message: response?.message || response?.detail || messages[mode] });
    } catch (err) {
      setFeedback({ kind: 'error', message: err.message });
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="source-config-panel card" data-testid="source-resources-panel">
      <div className="source-config-heading">
        <div>
          <span className="eyebrow">PROJECT RESOURCES</span>
          <h3>Connected knowledge</h3>
          <p>Add named folders, repositories, and Confluence pages, then sync each resource independently.</p>
        </div>
        <button className="primary source-add-button" data-testid="add-project-source" type="button" disabled={Boolean(busy)} onClick={() => openEditor()}>
          <Plus size={16} /> Add resource
        </button>
      </div>

      <div className={`source-feedback ${feedback?.kind || ''}`} data-testid="source-resource-feedback" aria-live="polite">
        {feedback?.kind === 'success' && <CheckCircle2 size={15} />}
        {feedback?.kind === 'error' && <CircleAlert size={15} />}
        {feedback?.message}
      </div>

      <div className="source-resource-list" data-testid="source-resource-list">
        {sources.map((source) => {
          const id = sourceId(source);
          const type = String(source.connectorType || source.sourceType || source.type || 'local').toLowerCase();
          const config = source.config || source.sourceConfig || {};
          const count = source.documentCount ?? source.sourceSummary?.documentCount;
          const syncedAt = source.lastSyncedAt || source.sourceSummary?.lastSyncedAt;
          const confluencePages = Array.isArray(config.pageUrls) ? config.pageUrls : parseLines(config.pageUrls);
          const summary = type === 'github'
            ? config.repository
            : type === 'confluence'
              ? `${confluencePages.length} page URL${confluencePages.length === 1 ? '' : 's'}`
              : config.sourceSubpath || '.';
          return (
            <article className="source-resource" data-testid="source-resource" data-source-id={id} key={id || source.name}>
              <span className={`source-resource-icon ${type}`}>{connectorIcon(type, 18)}</span>
              <div className="source-resource-copy">
                <div><strong>{source.name || 'Untitled resource'}</strong><StatusPill value={source.status || (syncedAt ? 'synced' : 'configured')} /></div>
                <span>{titleCase(type)} · {summary || 'Configuration saved'}</span>
                {(count !== undefined || syncedAt) && <small>{count !== undefined ? `${count} document${count === 1 ? '' : 's'}` : ''}{count !== undefined && syncedAt ? ' · ' : ''}{syncedAt ? `Synced ${new Date(syncedAt).toLocaleString()}` : ''}</small>}
              </div>
              <div className="source-resource-actions">
                <button className="project-inline-button" data-testid="edit-source" type="button" disabled={Boolean(busy)} onClick={() => openEditor(source)}><Pencil size={13} /> Edit</button>
                <button className="project-inline-button" data-testid="test-source" type="button" disabled={Boolean(busy)} onClick={() => runSourceAction('test', source)}>{busy === `test-${id}` ? <LoaderCircle className="spin" size={13} /> : <CheckCircle2 size={13} />} Test</button>
                <button className="project-inline-button" data-testid="sync-source" type="button" disabled={Boolean(busy)} onClick={() => runSourceAction('sync', source)}>{busy === `sync-${id}` ? <LoaderCircle className="spin" size={13} /> : <RefreshCcw size={13} />} Sync</button>
                <button className="project-inline-button danger" data-testid="delete-source" type="button" disabled={Boolean(busy)} onClick={() => runSourceAction('delete', source)}><Trash2 size={13} /> Delete</button>
              </div>
            </article>
          );
        })}
        {!sources.length && <div className="source-resource-empty"><HardDrive size={22} /><span>No resources configured yet.</span></div>}
      </div>

      {editor && (
        <form className="source-editor" data-testid="source-config-panel" onSubmit={saveSource}>
          <div className="source-editor-head">
            <div><span className="eyebrow">{editor.id ? 'EDIT RESOURCE' : 'NEW RESOURCE'}</span><h4>{editor.id ? editor.name || 'Resource' : 'Connect a knowledge resource'}</h4></div>
            <button className="source-editor-close" data-testid="cancel-source-editor" type="button" aria-label="Close resource editor" onClick={() => setEditor(null)}><X size={17} /></button>
          </div>

          <div className="source-config-fields">
            <SourceField label="Resource name" error={validationErrors.name} wide>
              <input data-testid="source-name" value={editor.name} maxLength={120} onChange={(event) => updateEditor('name', event.target.value)} placeholder="Engineering handbook" aria-invalid={Boolean(validationErrors.name)} />
            </SourceField>
          </div>

          <div className="source-type-tabs" data-testid="source-connector-type" role="radiogroup" aria-label="Source connector">
            {connectors.map((connector) => (
              <button className={editor.connectorType === connector.type ? 'source-type-tab selected' : 'source-type-tab'} data-testid={`source-type-${connector.type}`} key={connector.type} type="button" role="radio" aria-checked={editor.connectorType === connector.type} onClick={() => { updateEditor('connectorType', connector.type); setValidationErrors({}); }}>
                {connectorIcon(connector.type)} {connector.label}
              </button>
            ))}
          </div>

          <div className="source-config-fields">
            {editor.connectorType === 'local' && (
              <SourceField label="Source subpath" hint="Relative to the server’s configured project documents root." error={validationErrors.sourceSubpath} wide>
                <input data-testid="source-subpath" value={editor.config.sourceSubpath} onChange={(event) => updateConfig('sourceSubpath', event.target.value)} placeholder="team/project-docs" aria-invalid={Boolean(validationErrors.sourceSubpath)} />
              </SourceField>
            )}
            {editor.connectorType === 'github' && (
              <>
                <SourceField label="Repository" hint="GitHub URL or owner/repository. Credentials must not be embedded." error={validationErrors.repository} wide>
                  <input data-testid="github-repository" value={editor.config.repository} onChange={(event) => updateConfig('repository', event.target.value)} placeholder="https://github.com/acme/project" aria-invalid={Boolean(validationErrors.repository)} />
                </SourceField>
                <SourceField label="Branch, tag, or commit" error={validationErrors.ref}>
                  <input data-testid="github-ref" value={editor.config.ref} onChange={(event) => updateConfig('ref', event.target.value)} placeholder="main" aria-invalid={Boolean(validationErrors.ref)} />
                </SourceField>
                <SourceField label="Token environment variable" hint="Optional variable name only. Never paste a token or secret." error={validationErrors.tokenEnvVar}>
                  <input data-testid="github-token-env-var" value={editor.config.tokenEnvVar} onChange={(event) => updateConfig('tokenEnvVar', event.target.value)} placeholder="GITHUB_TOKEN" aria-invalid={Boolean(validationErrors.tokenEnvVar)} autoComplete="off" />
                </SourceField>
                <SourceField label="Include paths" hint="Optional paths or glob patterns, one per line." error={validationErrors.includePaths}>
                  <textarea data-testid="github-include-paths" value={editor.config.includePaths} onChange={(event) => updateConfig('includePaths', event.target.value)} placeholder={'docs/**\nREADME.md'} rows={3} aria-invalid={Boolean(validationErrors.includePaths)} />
                </SourceField>
                <SourceField label="Exclude paths" hint="Optional paths or glob patterns, one per line." error={validationErrors.excludePaths}>
                  <textarea data-testid="github-exclude-paths" value={editor.config.excludePaths} onChange={(event) => updateConfig('excludePaths', event.target.value)} placeholder={'**/archive/**\n**/*.tmp'} rows={3} aria-invalid={Boolean(validationErrors.excludePaths)} />
                </SourceField>
              </>
            )}
            {editor.connectorType === 'confluence' && (
              <>
                <SourceField label="Confluence page URLs" hint="One HTTPS page URL per line." error={validationErrors.pageUrls} wide>
                  <textarea data-testid="confluence-page-urls" value={editor.config.pageUrls} onChange={(event) => updateConfig('pageUrls', event.target.value)} placeholder={'https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Handbook\nhttps://acme.atlassian.net/wiki/spaces/ENG/pages/456/Runbooks'} rows={4} aria-invalid={Boolean(validationErrors.pageUrls)} />
                </SourceField>
                <SourceField label="Account email" hint="Optional account used by the configured token variable." error={validationErrors.accountEmail}>
                  <input data-testid="confluence-account-email" type="email" value={editor.config.accountEmail} onChange={(event) => updateConfig('accountEmail', event.target.value)} placeholder="docs-bot@acme.com" aria-invalid={Boolean(validationErrors.accountEmail)} />
                </SourceField>
                <SourceField label="Token environment variable" hint="Optional variable name only. Never paste a token or secret." error={validationErrors.tokenEnvVar}>
                  <input data-testid="confluence-token-env-var" value={editor.config.tokenEnvVar} onChange={(event) => updateConfig('tokenEnvVar', event.target.value)} placeholder="CONFLUENCE_TOKEN" aria-invalid={Boolean(validationErrors.tokenEnvVar)} autoComplete="off" />
                </SourceField>
                <label className="source-checkbox">
                  <input data-testid="confluence-include-descendants" type="checkbox" checked={editor.config.includeDescendants} onChange={(event) => updateConfig('includeDescendants', event.target.checked)} />
                  <span className="employee-check">{editor.config.includeDescendants && <Check size={13} />}</span>
                  <span><strong>Include descendant pages</strong><small>Sync child pages beneath each configured page.</small></span>
                </label>
              </>
            )}
          </div>

          <div className="source-config-footer">
            <p className="source-secret-note">Credentials are referenced by environment variable name and are never stored here.</p>
            <div className="source-config-actions">
              <button className="outline" type="button" disabled={Boolean(busy)} onClick={() => setEditor(null)}>Cancel</button>
              <button className="primary" data-testid="save-project-source" type="submit" disabled={Boolean(busy)}>{busy === 'save' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{busy === 'save' ? 'Saving…' : 'Save resource'}</button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}

function SourceField({ label, hint, error, wide = false, children }) {
  return (
    <label className={wide ? 'source-field wide' : 'source-field'}>
      <span>{label}</span>
      {children}
      {error ? <small className="source-field-error">{error}</small> : hint && <small>{hint}</small>}
    </label>
  );
}

function SourcePanel({ project, manager, busy, onSync }) {
  const documents = documentList(project);
  const sync = project.syncStatus || project.sourceSync?.status || project.source?.status || (project.lastSyncedAt ? 'synced' : 'not synced');
  const syncedAt = project.lastSyncedAt || project.sourceSummary?.lastSyncedAt || project.sourceSync?.syncedAt || project.source?.lastSyncedAt;
  const documentCount = project.documentCount ?? project.sourceSummary?.documentCount ?? documents.length;

  return (
    <section className="project-panel card">
      <div className="project-panel-head">
        <div><span className="eyebrow">KNOWLEDGE SOURCE</span><h3>Source documents</h3></div>
        <StatusPill value={sync} />
      </div>
      {syncedAt && <p className="project-sync-time"><Clock3 size={13} /> Last synced {new Date(syncedAt).toLocaleString()}</p>}
      <div className="project-documents">
        {documents.length ? documents.map((document, index) => (
          <div className="project-document" key={document.id || document.sourcePath || document.url || index}>
            <FileText size={17} />
            <div><strong>{document.name || document.title || document.sourcePath || `Source document ${index + 1}`}</strong><span>{document.type || document.status || (document.sizeBytes ? `${Math.max(1, Math.round(document.sizeBytes / 1024))} KB` : 'Project source')}</span></div>
            {(document.sourceUrl || document.url) && (
              <a href={document.sourceUrl || document.url} target="_blank" rel="noreferrer">View</a>
            )}
          </div>
        )) : (
          <p className="project-muted">
            {documentCount
              ? `${documentCount} approved source document${documentCount === 1 ? '' : 's'} ground this course${manager ? '.' : '; filenames are visible to project managers.'}`
              : 'No source documents have been synced yet.'}
          </p>
        )}
      </div>
      {manager && (
        <button className="outline project-action" data-testid="sync-project" type="button" disabled={Boolean(busy)} onClick={onSync}>
          {busy === 'sync' ? <LoaderCircle className="spin" size={16} /> : <RefreshCcw size={16} />}
          {busy === 'sync' ? 'Syncing sources…' : 'Sync sources'}
        </button>
      )}
    </section>
  );
}

function CoursePanel({ courses, manager, busy, onGenerate, onPublish }) {
  return (
    <section className="project-panel card">
      <div className="project-panel-head">
        <div><span className="eyebrow">COURSE LIFECYCLE</span><h3>Generated learning</h3></div>
        <span className="project-count">{courses.length}</span>
      </div>
      <div className="project-courses">
        {courses.length ? courses.map((course, index) => {
          const status = courseStatus(course);
          const id = course.id || course.courseId;
          return (
            <div className="project-course" key={id || index}>
              <span className="course-mark"><BookOpenCheck size={17} /></span>
              <div><strong>{course.title || course.name || `Project course ${index + 1}`}</strong><span>{course.description || course.content?.summary || `${asArray(course.modules || course.lessons || course.content?.lessons).length} learning sections`}</span></div>
              <StatusPill value={status} />
              {manager && status !== 'published' && (
                <button className="project-inline-button" data-testid="publish-course" type="button" disabled={Boolean(busy) || !id} onClick={() => onPublish(id)}>
                  {busy === `publish-${id}` ? 'Publishing…' : 'Publish'}
                </button>
              )}
            </div>
          );
        }) : <p className="project-muted">Generate a draft course after syncing the project sources.</p>}
      </div>
      {manager && (
        <button className="primary project-action" data-testid="generate-course" type="button" disabled={Boolean(busy)} onClick={onGenerate}>
          {busy === 'generate' ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
          {busy === 'generate' ? 'Generating course…' : 'Generate course'}
        </button>
      )}
    </section>
  );
}

function AssignmentPanel({ project, user, busy, setBusy, onChanged, onError }) {
  const [employees, setEmployees] = useState([]);
  const [selected, setSelected] = useState([]);

  useEffect(() => {
    api.getUsers().then((response) => {
      const list = asArray(response?.users || response);
      const eligible = list.filter((entry) => !entry.isManager && entry.id !== user.id);
      setEmployees(eligible);
      const preferred = eligible.find((entry) => entry.id === 'USR001') || eligible[0];
      if (preferred) setSelected([preferred.id]);
    }).catch((err) => onError(err.message));
  }, [project.id, user.id]);

  const assign = async () => {
    if (!selected.length) return;
    setBusy('assign');
    onError('');
    try {
      await api.assignProject(project.id, user.id, selected);
      await onChanged(`Course assigned to ${selected.length} employee${selected.length === 1 ? '' : 's'}.`);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy('');
    }
  };

  const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);

  return (
    <section className="assignment-panel card" data-testid="assignment-panel">
      <div>
        <span className="eyebrow">TEAM ASSIGNMENT</span>
        <h3>Assign published learning</h3>
        <p>Select the employees who need this project context.</p>
      </div>
      <div className="employee-picker">
        {employees.map((employee) => (
          <label className={selected.includes(employee.id) ? 'employee-option selected' : 'employee-option'} key={employee.id}>
            <input type="checkbox" checked={selected.includes(employee.id)} onChange={() => toggle(employee.id)} />
            <span className="employee-check">{selected.includes(employee.id) && <Check size={13} />}</span>
            <span><strong>{employee.name}</strong><small>{employee.role || employee.department}</small></span>
          </label>
        ))}
        {!employees.length && <span className="project-muted">No eligible employees found.</span>}
      </div>
      <button className="primary" data-testid="assign-course" type="button" disabled={Boolean(busy) || !selected.length} onClick={assign}>
        {busy === 'assign' ? <LoaderCircle className="spin" size={16} /> : <UserPlus size={16} />}
        {busy === 'assign' ? 'Assigning…' : `Assign to ${selected.length || ''} employee${selected.length === 1 ? '' : 's'}`}
      </button>
    </section>
  );
}

function LearnerPanel({ project, course, attempt, answers, report, busy, onStart, onAnswer, onSubmit }) {
  const questions = useMemo(() => getQuestions(attempt, course), [attempt, course]);
  const lessons = useMemo(() => getLessons(attempt, course), [attempt, course]);
  const answered = questions.filter((question, index) => answers[questionId(question, index)] !== undefined).length;
  const existingAttempt = project.activeAttempt || project.attempt;
  const canStart = Boolean(course || project.assignment || existingAttempt);

  if (report) return <ReportCard report={report} onRestart={canStart ? onStart : null} />;

  return (
    <section className="learner-panel card">
      {!attempt ? (
        <div className="learner-ready">
          <span className="learner-icon"><BookOpenCheck size={25} /></span>
          <div>
            <span className="eyebrow">YOUR ASSIGNMENT</span>
            <h3>{course?.title || course?.name || 'Project learning course'}</h3>
            <p>{course?.description || 'Review the project material, answer each knowledge check, and receive an instant report.'}</p>
          </div>
          <button className="primary" data-testid="start-course" type="button" disabled={Boolean(busy) || !canStart} onClick={onStart}>
            {busy === 'start' ? <LoaderCircle className="spin" size={16} /> : <BookOpenCheck size={16} />}
            {busy === 'start' ? 'Starting…' : 'Start course'}
          </button>
        </div>
      ) : (
        <div className="project-quiz">
          <div className="project-quiz-head">
            <div><span className="eyebrow">KNOWLEDGE CHECK</span><h3>{attempt.courseTitle || course?.title || 'Project assessment'}</h3></div>
            <strong>{answered}/{questions.length} answered</strong>
          </div>
          {lessons.length > 0 && (
            <div className="project-lessons">
              {lessons.map((lesson, index) => (
                <article key={lesson.id || index}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div><h4>{lesson.title || `Lesson ${index + 1}`}</h4><p>{lesson.body || lesson.content || lesson.summary}</p></div>
                </article>
              ))}
            </div>
          )}
          {questions.length ? questions.map((question, index) => {
            const id = questionId(question, index);
            const options = asArray(question.options || question.choices || question.answers);
            return (
              <fieldset className="project-question" key={id}>
                <legend><span>{index + 1}</span>{question.prompt || question.text || question.question}</legend>
                <div className="project-options">
                  {options.map((option, optionIndex) => {
                    const value = optionValue(option, optionIndex);
                    return (
                      <label className={answers[id] === value ? 'project-option selected' : 'project-option'} data-testid="question-option" key={value}>
                        <input type="radio" name={id} value={value} checked={answers[id] === value} onChange={() => onAnswer(id, value)} />
                        <span className="radio-mark" />
                        <span>{optionLabel(option)}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          }) : <p className="project-muted">This course has no knowledge-check questions yet.</p>}
          <button className="primary project-submit" data-testid="submit-course" type="button" disabled={Boolean(busy) || !questions.length || answered !== questions.length} onClick={onSubmit}>
            {busy === 'submit' ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
            {busy === 'submit' ? 'Submitting…' : 'Submit course'}
          </button>
        </div>
      )}
    </section>
  );
}

function ReportCard({ report, onRestart }) {
  const score = report.score ?? report.percentage ?? report.percent ?? 0;
  const passed = report.passed ?? Number(score) >= 70;
  const feedback = asArray(report.feedback || report.results || report.questionResults);

  return (
    <section className="project-report card" data-testid="course-report">
      <div className={passed ? 'report-score passed' : 'report-score'} data-testid="course-score">
        {passed ? <CheckCircle2 size={26} /> : <CircleAlert size={26} />}
        <strong>{score}{typeof score === 'number' || /^\d+$/.test(String(score)) ? '%' : ''}</strong>
        <span>{passed ? 'Course complete' : 'Review recommended'}</span>
      </div>
      <div className="report-copy">
        <span className="eyebrow">LEARNING REPORT</span>
        <h3>{report.title || (passed ? 'You understand the project essentials.' : 'A little more review will help.')}</h3>
        <p>{report.summary || report.message || 'Your answers were saved to your learning record.'}</p>
        {feedback.length > 0 && (
          <div className="report-feedback">
            {feedback.map((item, index) => (
              <div key={item.questionId || index}><CheckCircle2 size={14} /><span>{item.feedback || item.explanation || item.message || String(item)}</span></div>
            ))}
          </div>
        )}
        {onRestart && <button className="outline" type="button" onClick={onRestart}><RefreshCcw size={15} /> Retake course</button>}
      </div>
    </section>
  );
}

function StatusPill({ value }) {
  const normalized = String(value || 'pending').toLowerCase();
  const positive = ['ready', 'synced', 'published', 'complete', 'completed', 'assigned', 'managed', 'active'].some((entry) => normalized.includes(entry));
  return <span className={positive ? 'project-status positive' : 'project-status'}>{positive && <CheckCircle2 size={12} />}{titleCase(value || 'pending')}</span>;
}

function ProjectLoading({ label }) {
  return <div className="project-state card"><LoaderCircle className="spin" size={20} /><span>{label}</span></div>;
}

function ProjectError({ message }) {
  return <div className="project-error"><CircleAlert size={17} /><span>{message}</span></div>;
}
