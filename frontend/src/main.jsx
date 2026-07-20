import React, { lazy, startTransition, Suspense, useDeferredValue, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  ArrowRight,
  Award,
  BarChart3,
  Bell,
  Brain,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  Clock3,
  FileSearch,
  Flag,
  Flame,
  Gauge,
  Gamepad2,
  GraduationCap,
  LayoutGrid,
  LockKeyhole,
  Mail,
  Medal,
  Menu,
  Play,
  RefreshCcw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { api } from './api';
import ProjectsPage from './projects/ProjectsPage';
import './styles.css';

const GameMissionHub = lazy(() => import('./game/GameMissionHub'));

const PRIMARY_NAV = [
  ['My Training', GraduationCap],
  ['Projects', BriefcaseBusiness],
  ['Scenario Library', Gamepad2],
  ['My Learning', BarChart3],
  ['Policy Coach', Brain],
];

const SUPPORT_NAV = [
  ['Daily Challenge', Flame],
  ['Legacy Scenarios', Play],
  ['Achievements', Trophy],
];

const PAGE_INFO = {
  'My Training': ['My Training', 'Complete the interactive compliance training assigned to your role.'],
  Projects: ['Projects', 'Create and complete learning grounded in real project sources.'],
  'Mission Hub': ['Training Level', 'Explore the environment, meet characters, and complete your assigned compliance mission.'],
  'Daily Challenge': ['Daily Drill', 'Complete a short deterministic drill that reinforces today’s focus area.'],
  'Legacy Scenarios': ['Legacy Scenarios', 'Replay the seeded branching scenarios that remain available as support training.'],
  'Policy Coach': ['Policy Coach', 'Ask policy questions and receive concise answers grounded in approved guidance.'],
  'My Learning': ['My Learning', 'Track topic performance, progress trends, gaps, and next-best practice.'],
  Achievements: ['Achievements', 'Recognize learning discipline, consistency, and earned milestones.'],
  'Scenario Library': ['Scenario Library', 'Browse and launch interactive compliance game levels.'],
  'Manager Insights': ['Manager Insights', 'Review aggregate team patterns, weak topics, and campaign opportunities.'],
  Settings: ['Settings', 'Manage reminders, focus preferences and demo reset controls.'],
};

const TYPE_TO_PAGE = {
  'game-mission': 'Mission Hub',
  simulation: 'Legacy Scenarios',
  'daily-challenge': 'Daily Challenge',
};

const ACTIVE_AI_SESSION_KEY = 'compliance-ai-session-id';

const AI_TOPICS = [
  { id: 'aml', name: 'AML' },
  { id: 'kyc', name: 'KYC' },
  { id: 'data-privacy', name: 'Data Privacy' },
  { id: 'sanctions', name: 'Sanctions' },
  { id: 'market-abuse', name: 'Market Abuse' },
  { id: 'conduct-risk', name: 'Conduct Risk' },
  { id: 'information-security', name: 'Information Security' },
  { id: 'third-party-risk', name: 'Third-Party Risk' },
  { id: 'conflicts', name: 'Conflicts of Interest' },
  { id: 'regulatory-reporting', name: 'Regulatory Reporting' },
];

const AI_DIFFICULTIES = [
  { id: 'starter', label: 'Starter' },
  { id: 'standard', label: 'Standard' },
  { id: 'challenging', label: 'Challenging' },
];

function App() {
  const [page, setPage] = useState(() => window.location.pathname === '/projects' ? 'Projects' : 'My Training');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [toast, setToast] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [deepLink, setDeepLink] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const [selectedGameId, setSelectedGameId] = useState(null);

  useEffect(() => {
    const handlePopState = () => setPage(window.location.pathname === '/projects' ? 'Projects' : 'My Training');
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const storedUserId = window.localStorage.getItem('compliance-user-id');
    if (!storedUserId) {
      setBooting(false);
      return;
    }

    api.getUser(storedUserId)
      .then((response) => {
        if (!cancelled) {
          setUser(response.user);
        }
      })
      .catch(() => {
        window.localStorage.removeItem('compliance-user-id');
      })
      .finally(() => {
        if (!cancelled) {
          setBooting(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!user) {
      setAiStatus(null);
      return;
    }

    let cancelled = false;
    api.getAiStatus()
      .then((response) => {
        if (!cancelled) {
          setAiStatus(response);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setAiStatus({ status: 'unavailable', detail: err.message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user, refreshKey]);

  const navigate = (nextPage) => {
    const nextPath = nextPage === 'Projects' ? '/projects' : '/';
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ page: nextPage }, '', nextPath);
    }
    startTransition(() => {
      setPage(nextPage);
      setMobileOpen(false);
    });
  };

  const handleLogin = async (userId) => {
    const response = await api.login(userId);
    window.localStorage.setItem('compliance-user-id', userId);
    setUser(response.user);
    setPage(window.location.pathname === '/projects' ? 'Projects' : 'My Training');
    setToast(`Signed in as ${response.user.name}`);
  };

  const handleLogout = () => {
    window.localStorage.removeItem('compliance-user-id');
    setUser(null);
    setPage('My Training');
    setDeepLink(null);
    setAiStatus(null);
  };

  const handleActivityComplete = (message) => {
    setRefreshKey((value) => value + 1);
    if (message) {
      setToast(message);
    }
  };

  const handleLaunch = (activity) => {
    const nextPage = TYPE_TO_PAGE[activity.type];
    if (!nextPage) {
      return;
    }
    if (activity.type === 'game-mission') {
      setSelectedGameId(activity.id);
    }
    setDeepLink(activity);
    navigate(nextPage);
  };

  const clearDeepLink = () => setDeepLink(null);

  if (booting) {
    return <BootScreen />;
  }

  if (!user) {
    return (
      <div className="app-shell">
        <LoginScreen onLogin={handleLogin} />
        {toast && <Toast message={toast} />}
      </div>
    );
  }

  const [title, subtitle] = PAGE_INFO[page] || PAGE_INFO['My Training'];

  return (
    <div className="app">
      <Sidebar
        mobileOpen={mobileOpen}
        page={page}
        user={user}
        aiStatus={aiStatus}
        onClose={() => setMobileOpen(false)}
        onLogout={handleLogout}
        onNavigate={navigate}
      />
      <main className="main-panel">
        <header className="topbar">
          <button className="icon menu" onClick={() => setMobileOpen(true)}>
            <Menu />
          </button>
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="header-actions">
            <button className="notification">
              <Bell size={18} />
              <em />
            </button>
            <div className="profile-chip">
              <div className="header-avatar">{initials(user.name)}</div>
              <div>
                <strong>{user.name}</strong>
                <span>{user.role}</span>
              </div>
              <ChevronDown size={16} />
            </div>
          </div>
        </header>
        <section className="content">
          {page === 'My Training' && (
            <TrainingHomePage key={`training-${refreshKey}`} user={user} onLaunch={handleLaunch} />
          )}
          {page === 'Projects' && (
            <ProjectsPage user={user} onNotify={setToast} />
          )}
          {page === 'Mission Hub' && (
            <Suspense fallback={<LoadingCard label="Loading interactive mission hub" />}>
              <GameMissionHub
                key={`game-${refreshKey}`}
                user={user}
                initialScenarioId={selectedGameId}
                onComplete={() => setToast('Game mission completed and learning progress saved.')}
              />
            </Suspense>
          )}
          {page === 'Daily Challenge' && (
            <DailyChallengePage
              key={`daily-${refreshKey}`}
              user={user}
              onComplete={() => handleActivityComplete('Daily challenge recorded.')}
              onNavigate={navigate}
              deepLink={deepLink}
              clearDeepLink={clearDeepLink}
            />
          )}
          {page === 'Legacy Scenarios' && (
            <SimulationsPage
              key={`sim-${refreshKey}`}
              user={user}
              onComplete={() => handleActivityComplete('Simulation progress updated.')}
              deepLink={deepLink}
              clearDeepLink={clearDeepLink}
              onNavigate={navigate}
            />
          )}
          {page === 'Policy Coach' && <CoachPage user={user} />}
          {page === 'My Learning' && <LearningPage key={`learning-${refreshKey}`} user={user} onLaunch={handleLaunch} />}
          {page === 'Achievements' && <AchievementsPage key={`badges-${refreshKey}`} user={user} />}
          {page === 'Scenario Library' && (
            <GameLibraryPage
              key={`library-${refreshKey}`}
              user={user}
              onLaunch={handleLaunch}
            />
          )}
          {page === 'Manager Insights' && user.isManager && <ManagerPage key={`manager-${refreshKey}`} />}
          {page === 'Settings' && (
            <SettingsPage
              user={user}
              onReset={() => {
                handleActivityComplete('Demo data reset. Seeded history is still available.');
                clearDeepLink();
              }}
            />
          )}
        </section>
      </main>
      {toast && <Toast message={toast} />}
    </div>
  );
}

function BootScreen() {
  return (
    <div className="boot">
      <ShieldAlert size={28} />
      <h2>Loading Compliance Simulation Hub</h2>
      <p>Restoring your saved session and learning profile.</p>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getUsers()
      .then((response) => {
        setUsers(response);
        setSelectedUserId(response[0]?.id || '');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const selectedUser = users.find((entry) => entry.id === selectedUserId);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!selectedUserId) {
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onLogin(selectedUserId);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-panel">
        <div className="login-brand">
          <div className="brand-mark"><ShieldAlert size={20} /></div>
          <div>
            <span>Compliance AI Workspace</span>
            <strong>Live Simulation Environment</strong>
          </div>
        </div>
        <h1>Train real compliance judgment inside a live AI workspace.</h1>
        <p>
          Launch high-pressure scenarios, respond in free text, review generated evidence, and build
          better escalation habits through consequence-based training.
        </p>
        {loading ? (
          <LoadingCard label="Loading seeded users" />
        ) : (
          <form className="login-form" onSubmit={handleSubmit}>
            <label>
              <span>Select a seeded prototype user</span>
              <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
                {users.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} · {entry.role}
                  </option>
                ))}
              </select>
            </label>
            {selectedUser && (
              <div className="login-preview card">
                <div>
                  <strong>{selectedUser.name}</strong>
                  <span>{selectedUser.role}</span>
                </div>
                <div>
                  <strong>{selectedUser.department}</strong>
                  <span>{selectedUser.isManager ? 'Manager view available' : `${selectedUser.experienceYears} years experience`}</span>
                </div>
              </div>
            )}
            {error && <ErrorNotice message={error} />}
            <button className="primary wide" disabled={submitting || !selectedUserId}>
              <Play size={16} />
              {submitting ? 'Signing in...' : 'Enter AI workspace'}
            </button>
          </form>
        )}
      </div>
      <div className="login-showcase">
        <div className="hero card">
          <span className="eyebrow"><Sparkles size={14} /> AI-FIRST COMPLIANCE OPERATIONS</span>
          <h2>Simulate the pressure before it becomes an incident.</h2>
          <p>
            The platform now leads with live AI simulation while preserving support drills, policy
            guidance, and manager-level insight views around the main workspace.
          </p>
          <div className="hero-meta">
            <span><Brain size={15} /> Live AI simulations</span>
            <span><BarChart3 size={15} /> Persistent training history</span>
            <span><ShieldCheck size={15} /> Policy-grounded support tools</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ mobileOpen, onClose, onNavigate, onLogout, page, user, aiStatus }) {
  return (
    <aside className={mobileOpen ? 'sidebar open' : 'sidebar'}>
      <div className="brand">
        <div className="brand-mark"><ShieldAlert size={18} /></div>
        <div>
          <span>Compliance AI</span>
          <strong>Workspace</strong>
        </div>
        <button className="icon mobile-close" onClick={onClose}>
          <X />
        </button>
      </div>
      <div className="nav">
        <div className="nav-label">WORKSPACE</div>
        {PRIMARY_NAV.map(([label, Icon]) => (
          <button key={label} data-testid={label === 'Projects' ? 'projects-nav' : undefined} className={page === label ? 'active' : ''} onClick={() => onNavigate(label)}>
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
        <div className="nav-label">SUPPORT TOOLS</div>
        {SUPPORT_NAV.map(([label, Icon]) => (
          <button key={label} className={page === label ? 'active' : ''} onClick={() => onNavigate(label)}>
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
        {user.isManager && (
          <>
            <div className="nav-label">LEADERSHIP</div>
            <button className={page === 'Manager Insights' ? 'active' : ''} onClick={() => onNavigate('Manager Insights')}>
              <Users size={18} />
              <span>Manager Insights</span>
            </button>
          </>
        )}
      </div>
      <div className="sidebar-bottom">
        <button className={page === 'Settings' ? 'active' : ''} onClick={() => onNavigate('Settings')}>
          <Settings size={18} />
          <span>Settings</span>
        </button>
        <div className="profile">
          <div className="avatar">{initials(user.name)}</div>
          <div>
            <b>{user.name}</b>
            <small>{user.role}</small>
          </div>
          <button className="text-btn" onClick={onLogout}>Switch</button>
        </div>
      </div>
    </aside>
  );
}

function TrainingHomePage({ user, onLaunch }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getTrainingAssignments(user.id).then(setData).catch((err) => setError(err.message));
  }, [user.id]);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <LoadingCard label="Loading assigned training" />;

  return (
    <div className="training-home">
      <section className="training-hero">
        <div>
          <span className="eyebrow"><GraduationCap size={14} /> EMPLOYEE TRAINING PLAN</span>
          <h2>Welcome back, {user.name.split(' ')[0]}</h2>
          <p>Complete the game-based compliance training assigned to your role. Each level reacts to your decisions and records the outcome in My Learning.</p>
        </div>
        <div className="training-summary">
          <div><strong>{data.summary.pending}</strong><span>Pending</span></div>
          <div><strong>{data.summary.completed}</strong><span>Completed</span></div>
          <div><strong>{data.summary.assigned}</strong><span>Assigned</span></div>
        </div>
      </section>

      <div className="training-section-head">
        <div>
          <span className="eyebrow">REQUIRED TRAINING</span>
          <h3>Your pending levels</h3>
        </div>
        <span className="tag amber">{data.summary.pending} remaining</span>
      </div>

      {data.pending.length ? (
        <div className="training-assignment-grid">
          {data.pending.map((training, index) => (
            <article className="training-assignment-card" key={training.id}>
              <div className="training-card-index">{String(index + 1).padStart(2, '0')}</div>
              <div className="training-card-copy">
                <div className="training-card-tags">
                  <span>{training.topicName}</span>
                  <span>{training.difficulty}</span>
                  {training.navigationMode === 'ai-assisted' && <span className="ai-route-tag">Adaptive path</span>}
                </div>
                <h3>{training.title}</h3>
                <p>{training.brief}</p>
                <div className="training-card-meta">
                  <span><Clock3 size={14} /> {training.estimatedMinutes} min</span>
                  <span><Target size={14} /> Due in {training.dueInDays} days</span>
                  <span><LayoutGrid size={14} /> {training.world.scene?.name || training.world.room}</span>
                </div>
              </div>
              <button className="primary training-start" onClick={() => onLaunch({ id: training.id, type: 'game-mission' })}>
                Start training <ArrowRight size={17} />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="card training-empty">
          <ShieldCheck size={30} />
          <h3>All assigned training is complete</h3>
          <p>Replay a level from Scenario Library or review your results in My Learning.</p>
        </div>
      )}

      {data.completed.length > 0 && (
        <section className="card completed-training-strip">
          <div>
            <span className="eyebrow">RECENTLY COMPLETED</span>
            <h3>Completed game levels</h3>
          </div>
          <div className="completed-training-list">
            {data.completed.slice(0, 4).map((training) => (
              <button key={training.id} onClick={() => onLaunch({ id: training.id, type: 'game-mission' })}>
                <Check size={15} />
                <span><b>{training.title}</b><small>Best score {training.bestScore}%</small></span>
                <Play size={14} />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AIWorkspacePage({ user, onLaunch, onNavigate, aiStatus }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [topicId, setTopicId] = useState('data-privacy');
  const [difficulty, setDifficulty] = useState('standard');
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [composer, setComposer] = useState('');
  const [activeSession, setActiveSession] = useState(null);
  const [resumeSession, setResumeSession] = useState(null);
  const [resumeLoading, setResumeLoading] = useState(true);

  useEffect(() => {
    api.getDashboard(user.id).then(setData).catch((err) => setError(err.message));
  }, [user.id]);

  useEffect(() => {
    let cancelled = false;
    const storedSessionId = window.localStorage.getItem(ACTIVE_AI_SESSION_KEY);
    if (!storedSessionId) {
      setResumeLoading(false);
      return undefined;
    }

    api.getAiSimulation(storedSessionId, user.id)
      .then((response) => {
        if (cancelled) {
          return;
        }
        if (response.session.status === 'completed') {
          window.localStorage.removeItem(ACTIVE_AI_SESSION_KEY);
          setResumeSession(null);
          return;
        }
        setResumeSession(response);
      })
      .catch(() => {
        window.localStorage.removeItem(ACTIVE_AI_SESSION_KEY);
        if (!cancelled) {
          setResumeSession(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setResumeLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const models = aiStatus?.models || [];
  const smallReady = models.some((model) => model.name === aiStatus?.smallModel);
  const largeReady = models.some((model) => model.name === aiStatus?.largeModel);
  const aiReady = aiStatus?.status === 'ok' && smallReady && largeReady;

  const startSimulation = async () => {
    setStarting(true);
    setError('');
    try {
      const response = await api.startAiSimulation({
        userId: user.id,
        topicId,
        difficulty,
        sessionType: 'simulation',
      });
      setActiveSession(response);
      setResumeSession(response);
      setComposer('');
      window.localStorage.setItem(ACTIVE_AI_SESSION_KEY, response.session.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  };

  const submitTurn = async (closeSession = false) => {
    if (!activeSession || !composer.trim()) {
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const response = await api.submitAiSimulationTurn(activeSession.session.id, {
        userId: user.id,
        learnerResponse: composer.trim(),
        closeSession,
      });
      setActiveSession(response);
      setComposer('');
      if (response.session.status === 'completed') {
        setResumeSession(null);
        window.localStorage.removeItem(ACTIVE_AI_SESSION_KEY);
      } else {
        setResumeSession(response);
        window.localStorage.setItem(ACTIVE_AI_SESSION_KEY, response.session.id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const clearLiveView = () => {
    setActiveSession(null);
    setComposer('');
  };

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <LoadingCard label="Loading AI workspace" />;

  const sessionBundle = activeSession;
  const session = sessionBundle?.session;
  const turns = sessionBundle?.turns || [];
  const sessionState = session?.state || null;
  const latestEvaluation = sessionState?.lastEvaluation
    || [...turns].reverse().find((turn) => turn.evaluation)?.evaluation
    || null;
  const topicLabel = topicNameFromId(sessionState?.topicId || topicId);
  const liveArtifact = sessionState?.artifact;

  return (
    <>
      <div className="hero workspace-hero">
        <div className="hero-orb" />
        <span className="eyebrow"><Sparkles size={14} /> LIVE AI COMPLIANCE ORCHESTRATION</span>
        <h2>{data.greeting}</h2>
        <p>Start a policy-grounded simulation, respond in free text, and work through consequences, evidence, and escalation choices in one workspace.</p>
        <div className="hero-meta">
          <span><Brain size={15} /> {aiReady ? 'AI simulation ready' : 'Fallback mode available'}</span>
          <span><Clock3 size={15} /> Daily drill: {data.dailyChallenge.estimatedMinutes} min</span>
          <span><Target size={15} /> Current focus: {data.currentLearningFocus.name}</span>
        </div>
        <div className="hero-actions">
          <button className="primary" onClick={startSimulation} disabled={!aiReady || starting}>
            <Sparkles size={16} />
            {starting ? 'Launching simulation...' : 'Start AI simulation'}
          </button>
          <button className="outline ghost" onClick={() => onNavigate('Scenario Library')}>
            Browse activity library
          </button>
        </div>
      </div>

      {aiStatus?.status !== 'ok' && (
        <div className="workspace-banner workspace-banner-alert">
          <AlertTriangle size={18} />
          <div>
            <b>AI workspace is currently in fallback mode.</b>
            <span>{aiStatus?.detail || 'Ollama is unavailable, so live simulation start is disabled. Support tools remain usable.'}</span>
          </div>
        </div>
      )}

      {!sessionBundle ? (
        <div className="workspace-launch-grid">
          <article className="card workspace-launch-card">
            <div className="workspace-head">
              <div>
                <span className="eyebrow">AI WORKSPACE OVERVIEW</span>
                <h3>Launch the next live scenario</h3>
              </div>
              <span className={aiReady ? 'tag green' : 'tag red'}>{aiReady ? 'Live AI' : 'Fallback Mode'}</span>
            </div>
            <p className="workspace-intro">
              Choose a topic and challenge level, then let the simulation engine create the next case, actor message, and artifact pack in real time.
            </p>
            <div className="workspace-form-grid">
              <label>
                <span>Topic</span>
                <select value={topicId} onChange={(event) => setTopicId(event.target.value)}>
                  {AI_TOPICS.map((topic) => (
                    <option key={topic.id} value={topic.id}>{topic.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Difficulty</span>
                <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
                  {AI_DIFFICULTIES.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="workspace-actions">
              <button className="primary" onClick={startSimulation} disabled={!aiReady || starting}>
                <Sparkles size={16} />
                {starting ? 'Launching simulation...' : 'Start AI simulation'}
              </button>
              <button className="outline" onClick={() => onLaunch({ id: data.dailyChallenge.id, type: 'daily-challenge' })}>
                <Flame size={16} />
                Open daily drill
              </button>
            </div>
            {resumeLoading ? (
              <div className="workspace-inline-note">Checking for an active AI session...</div>
            ) : resumeSession ? (
              <div className="resume-card">
                <div>
                  <span className="eyebrow">RESUME ACTIVE SIMULATION</span>
                  <b>{resumeSession.session.state.title}</b>
                  <p>{topicNameFromId(resumeSession.session.topicId)} · {difficultyLabel(resumeSession.session.difficulty)} · {resumeSession.session.state.turnCount || resumeSession.turns.length} turns</p>
                </div>
                <button className="outline" onClick={() => setActiveSession(resumeSession)}>
                  Resume active simulation
                </button>
              </div>
            ) : (
              <div className="workspace-inline-note">No active AI session is waiting to be resumed.</div>
            )}
          </article>
        </div>
      ) : (
        <div className="workspace-session-layout">
          <div className="workspace-stream">
            <div className="workspace-session-head">
              <div className="workspace-session-copy">
                <span className="eyebrow">LIVE SESSION</span>
                <h3>{sessionState?.title}</h3>
                <p>{sessionState?.summary}</p>
              </div>
              <div className="tag-row left workspace-session-tags">
                <span className="tag violet">{topicLabel}</span>
                <span className="tag">{difficultyLabel(session?.difficulty)}</span>
                <span className={session?.status === 'completed' ? 'tag green' : 'tag blue'}>{session?.status === 'completed' ? 'Completed' : 'In progress'}</span>
              </div>
            </div>

            <article className="card workspace-casefile">
              <div className="workspace-case-grid">
                <div>
                  <span className="eyebrow">CURRENT EVENT</span>
                  <h4>{sessionState?.currentSituation?.speaker}</h4>
                  <p className="workspace-message">{sessionState?.currentSituation?.message}</p>
                </div>
                <div className="workspace-case-meta">
                  <div><strong>Channel</strong><span>{sessionState?.currentSituation?.channel}</span></div>
                  <div><strong>Location</strong><span>{sessionState?.currentSituation?.location}</span></div>
                  <div><strong>Time</strong><span>{sessionState?.currentSituation?.time}</span></div>
                </div>
              </div>
              {liveArtifact && (
                <div className="artifact-card">
                  <div className="artifact-head">
                    <span className="eyebrow">GENERATED ARTIFACT</span>
                    <span className="tag">{liveArtifact.type}</span>
                  </div>
                  <h4>{liveArtifact.title}</h4>
                  <p>{liveArtifact.content}</p>
                </div>
              )}
            </article>

            <div className="timeline-list">
              {turns.map((turn) => (
                <TimelineTurn key={turn.id} turn={turn} />
              ))}
            </div>
          </div>

          <aside className="card workspace-rail">
            <div className="workspace-rail-section">
              <span className="eyebrow">YOUR RESPONSE</span>
              <h3>{sessionState?.responsePrompt || 'What would you do next?'}</h3>
              <textarea
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                placeholder="Describe the action you would take, the control you would apply, and whether you would escalate."
                disabled={session?.status === 'completed'}
              />
              <div className="workspace-actions vertical">
                <button className="primary full" disabled={!composer.trim() || submitting || session?.status === 'completed'} onClick={() => submitTurn(false)}>
                  <Send size={16} />
                  {submitting ? 'Sending response...' : 'Send response'}
                </button>
                <button className="outline full" disabled={!composer.trim() || submitting || session?.status === 'completed'} onClick={() => submitTurn(true)}>
                  Finalize with this response
                </button>
                <button className="outline full" onClick={clearLiveView}>
                  Back to workspace overview
                </button>
              </div>
            </div>

            <div className="workspace-rail-section">
              <span className="eyebrow">SESSION METADATA</span>
              <div className="status-list compact">
                <StatusListItem label="Turn count" value={`${turns.length}`} tone="violet" />
                <StatusListItem label="Topic" value={topicLabel} tone="green" />
                <StatusListItem label="Difficulty" value={difficultyLabel(session?.difficulty)} tone="blue" />
              </div>
            </div>

            <div className="workspace-rail-section">
              <span className="eyebrow">RISK SIGNALS</span>
              <div className="tag-row left">
                {(sessionState?.riskSignals || []).map((signal) => <span className="tag amber" key={signal}>{signal}</span>)}
              </div>
              <div className="workspace-mini-section">
                <span className="eyebrow">LEARNING OBJECTIVES</span>
                {(sessionState?.learningObjectives || []).map((objective) => (
                  <div key={objective} className="workspace-bullet">{objective}</div>
                ))}
              </div>
            </div>

            {latestEvaluation && (
              <div className="workspace-rail-section evaluation-card">
                <span className="eyebrow">LATEST EVALUATION</span>
                <div className="evaluation-score">
                  <strong>{latestEvaluation.score}%</strong>
                  <span>{latestEvaluation.label}</span>
                </div>
                <InsightMini title="Strengths" items={latestEvaluation.strengths} />
                <InsightMini title="Gaps" items={latestEvaluation.gaps} />
                <InsightMini title="Policy reasoning" items={latestEvaluation.policyReasoning} />
                <div className="workspace-mini-section">
                  <span className="eyebrow">RECOMMENDED ACTION</span>
                  <p>{latestEvaluation.recommendedAction}</p>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      <div className="stats">
        <MetricCard icon={Target} color="green" value={`${data.learningSummary.overallScore}%`} label="Learning score" />
        <MetricCard icon={Flame} color="amber" value={`${data.learningSummary.streak}`} label="Current streak" />
        <MetricCard icon={ClipboardIcon} color="blue" value={`${data.learningSummary.scenariosCompleted}`} label="Completed exercises" />
        <MetricCard icon={Award} color="violet" value={`${data.learningSummary.badgesEarned}`} label="Milestones earned" />
      </div>

      <div className="dashboard-grid">
        <article className="card progress-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">WORKSPACE FOCUS</span>
              <h3>Priority reinforcement areas</h3>
            </div>
          </div>
          <div className="topic-list">
            {data.topicFocus.map((topic) => (
              <div key={topic.id}>
                <span>{topic.name}</span>
                <div className="mini-bar"><i style={{ width: `${topic.score}%` }} /></div>
                <b>{topic.label}</b>
              </div>
            ))}
          </div>
        </article>
        <article className="card activity">
          <div className="card-head">
            <div>
              <span className="eyebrow">NEXT BEST ACTIONS</span>
              <h3>Support tools and follow-ups</h3>
            </div>
          </div>
          {data.recommendations.map((rec) => (
            <RecommendationCard
              key={rec.id}
              title={rec.title}
              reason={rec.reason}
              onClick={() => onLaunch({ id: rec.activityId, type: rec.activityType })}
            />
          ))}
        </article>
      </div>

      <h3 className="section-title">Support modules</h3>
      <div className="mode-grid">
        {data.trainingModes.map((mode) => (
          <button key={mode.id} className="mode card" onClick={() => onNavigate(normalizePageName(mode.id))}>
            <div className="mode-icon violet"><Play size={18} /></div>
            <b>{mode.label}</b>
            <span>{mode.description}</span>
            <span className="arrow">Open support tool</span>
          </button>
        ))}
      </div>

      <h3 className="section-title">Recent training activity</h3>
      <div className="card activity log-card">
        {data.recentActivity.map((entry) => (
          <div key={entry.id} className="activity-row">
            <div className={`dot ${entry.score >= 85 ? 'good' : entry.score >= 70 ? 'violet' : 'amber'}`} />
            <div>
              <b>{entry.title}</b>
              <span>{entry.type} · {entry.date} · {entry.score}%</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function DailyChallengePage({ user, onComplete, onNavigate, deepLink, clearDeepLink }) {
  const [challenge, setChallenge] = useState(null);
  const [answers, setAnswers] = useState({});
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadChallenge = () => {
    api.getDailyChallenge(user.id).then((response) => {
      setChallenge(response);
      setAnswers({});
      setReport(null);
    }).catch((err) => setError(err.message));
  };

  useEffect(() => {
    loadChallenge();
  }, [user.id]);

  useEffect(() => {
    if (deepLink?.type === 'daily-challenge') {
      clearDeepLink();
    }
  }, [deepLink, clearDeepLink]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const nextReport = await api.submitDailyChallenge(challenge.id, { userId: user.id, answers });
      setReport(nextReport);
      onComplete();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (error) return <ErrorNotice message={error} />;
  if (!challenge) return <LoadingCard label="Loading today's challenge" />;
  if (report) {
    return (
      <ReportPanel
        report={report}
        onReplay={loadChallenge}
        onHome={() => onNavigate('My Training')}
      />
    );
  }

  const answeredAll = challenge.questions.every((question) => answers[question.id]);

  return (
    <div className="stack">
      <div className="center-card card">
        <div className="challenge-icon"><Flame /></div>
        <span className="eyebrow">TODAY'S DAILY CHALLENGE</span>
        <h2>{challenge.title}</h2>
        <p>{challenge.scenarioSummary}</p>
        <div className="tag-row">
          <span className="tag amber">{challenge.topicName}</span>
          <span className="tag">{challenge.difficulty}</span>
          <span className="tag">{challenge.estimatedMinutes} minutes</span>
        </div>
      </div>

      {challenge.questions.map((question, index) => (
        <article key={question.id} className="card question-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">DAILY DRILL {index + 1}</span>
              <h3>{question.prompt}</h3>
            </div>
          </div>
          <div className="option-group">
            {question.options.map((option) => (
              <button
                key={option.id}
                className={answers[question.id] === option.id ? 'option chosen' : 'option'}
                onClick={() => setAnswers((current) => ({ ...current, [question.id]: option.id }))}
              >
                <span>{String.fromCharCode(65 + question.options.indexOf(option))}</span>
                {option.label}
              </button>
            ))}
          </div>
        </article>
      ))}

      <div className="actions-bar">
        <button className="primary" disabled={!answeredAll || submitting} onClick={handleSubmit}>
          <Check size={16} />
          {submitting ? 'Scoring...' : 'Submit challenge'}
        </button>
      </div>
    </div>
  );
}

function SimulationsPage({ user, onComplete, deepLink, clearDeepLink, onNavigate }) {
  const [scenarios, setScenarios] = useState([]);
  const [active, setActive] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [selectedOption, setSelectedOption] = useState('');
  const [selectedReason, setSelectedReason] = useState('');
  const [consequence, setConsequence] = useState(null);

  useEffect(() => {
    api.listScenarios(user.id).then(setScenarios).catch((err) => setError(err.message));
  }, [user.id]);

  useEffect(() => {
    if (!deepLink || deepLink.type !== 'simulation') {
      return;
    }
    handleStart(deepLink.id);
    clearDeepLink();
  }, [deepLink]);

  const handleStart = async (scenarioId) => {
    try {
      const response = await api.startScenario(scenarioId, user.id);
      setActive(response);
      setReport(null);
      setSelectedOption('');
      setSelectedReason('');
      setConsequence(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const submitDecision = async () => {
    if (!selectedOption) {
      return;
    }
    try {
      const response = await api.submitScenarioDecision(active.scenario.id, {
        userId: user.id,
        attemptId: active.attemptId,
        nodeId: active.node.id,
        optionId: selectedOption,
        reasoningId: selectedReason || null,
      });
      if (response.complete) {
        setReport(response.report);
        setActive(null);
        onComplete();
        return;
      }
      setConsequence(response);
    } catch (err) {
      setError(err.message);
    }
  };

  if (error) return <ErrorNotice message={error} />;
  if (report) {
    return (
      <ReportPanel
        report={report}
        onReplay={() => handleStart(report.activityId)}
        onHome={() => onNavigate('My Training')}
      />
    );
  }

  if (active) {
    const node = active.node;
    return (
      <div className="simulation simulation-shell">
        <div className="simulation-topbar">
          <button className="back" onClick={() => setActive(null)}>← Back to simulations</button>
          <div className="simulation-status">
            <span className="eyebrow">Legacy scenario</span>
            <div className="tag-row">
              <span className="tag violet">{active.scenario.topicNames.join(' · ')}</span>
              <span className="tag">{active.scenario.difficulty}</span>
              <span className="tag">{active.scenario.estimatedMinutes} min</span>
            </div>
          </div>
        </div>
        <div className="sim-layout">
          <article className="email card case-card">
            <div className="email-top case-head">
              <div className="mail-icon case-icon-box"><Mail size={18} /></div>
              <div className="case-title">
                <span className="eyebrow">Scenario brief</span>
                <h2>{active.scenario.title}</h2>
                <span>{node.time} · {node.location}</span>
              </div>
            </div>
            <div className="detail-grid case-meta-grid">
              <div><strong>Speaker</strong><span>{node.speaker}</span></div>
              <div><strong>Channel</strong><span>{node.channel}</span></div>
            </div>
            <div className="case-summary">
              <span className="eyebrow">Pressure context</span>
              <p className="context-line">{node.context}</p>
            </div>
            <div className="case-message">
              <span className="eyebrow">Incoming request</span>
              <p className="email-body">{node.content}</p>
            </div>
            {node.supportingDocument && (
              <div className="supporting-doc case-artifact">
                <span className="eyebrow">Attached context</span>
                <p>{node.supportingDocument}</p>
              </div>
            )}
          </article>

          <aside className="decision card decision-panel">
            <div className="decision-header">
              <span className="eyebrow">Step {node.step} of {active.scenario.nodes.length}</span>
              <h3>Choose the best next move</h3>
              <p>Select the action you would actually take in this situation.</p>
            </div>
            <div className="decision-section">
              <div className="option-group">
                {node.options.map((option) => (
                  <button
                    key={option.id}
                    className={selectedOption === option.id ? 'option chosen' : 'option'}
                    onClick={() => setSelectedOption(option.id)}
                  >
                    <span>{String.fromCharCode(65 + node.options.indexOf(option))}</span>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {node.reasoningOptions?.length > 0 && (
              <div className="reasoning-box reasoning-panel">
                <div className="reasoning-head">
                  <span className="eyebrow">Optional reasoning</span>
                  <p>Tell the report what influenced your decision.</p>
                </div>
                <div className="chip-row">
                  {node.reasoningOptions.map((reason) => (
                    <button
                      key={reason.id}
                      className={selectedReason === reason.id ? 'filter selected' : 'filter'}
                      onClick={() => setSelectedReason(reason.id)}
                    >
                      {reason.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="decision-footer">
              {!consequence ? (
                <button className="primary full" disabled={!selectedOption} onClick={submitDecision}>
                  Submit decision
                </button>
              ) : (
                <div className="feedback consequence-panel">
                  <span className="eyebrow">Immediate consequence</span>
                  <b>What happened next</b>
                  <p>{consequence.consequence}</p>
                  <button
                    className="text-btn"
                    onClick={() => {
                      setActive((current) => ({ ...current, node: consequence.nextNode }));
                      setSelectedOption('');
                      setSelectedReason('');
                      setConsequence(null);
                    }}
                  >
                    Continue to next step →
                  </button>
                </div>
              )}
              {!consequence && (
                <div className="decision-note">
                  <span className="eyebrow">Decision principle</span>
                  <p>Prioritize approved channels, verification, and escalation over urgency or hierarchy.</p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="banner">
        <Brain />
        <div>
          <b>Legacy branching scenarios remain available as support content.</b>
          <span>Use these seeded paths when you want deterministic replay instead of live AI generation.</span>
        </div>
      </div>
      <div className="scenario-grid">
        {scenarios.map((scenario) => (
          <article key={scenario.id} className="scenario card">
            <div className="scenario-cover">
              <ShieldCheck size={24} />
              <span>{scenario.difficulty}</span>
            </div>
            <div className="scenario-body">
              <span className="tag violet">{scenario.topicNames.join(' · ')}</span>
              <h3>{scenario.title}</h3>
              <p>{scenario.description}</p>
              <div className="scenario-meta">{scenario.estimatedMinutes} min · {scenario.attempts} attempt(s)</div>
              <button className="outline" onClick={() => handleStart(scenario.id)}>
                {scenario.completed ? 'Replay scenario' : 'Start scenario'} <Play size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function RedFlagPage({ user, onComplete, deepLink, clearDeepLink }) {
  const [list, setList] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [selected, setSelected] = useState([]);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listRedFlags(user.id).then((items) => {
      setList(items);
      setSelectedId(items[0]?.id || '');
    }).catch((err) => setError(err.message));
  }, [user.id]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    api.getRedFlag(user.id, selectedId).then((item) => {
      setDetail(item);
      setSelected([]);
      setReport(null);
    }).catch((err) => setError(err.message));
  }, [selectedId, user.id]);

  useEffect(() => {
    if (deepLink?.type === 'red-flag') {
      setSelectedId(deepLink.id);
      clearDeepLink();
    }
  }, [deepLink]);

  const toggle = (fragmentId) => {
    setSelected((current) => (
      current.includes(fragmentId)
        ? current.filter((value) => value !== fragmentId)
        : [...current, fragmentId]
    ));
  };

  const submit = async () => {
    try {
      const nextReport = await api.submitRedFlags(detail.id, { userId: user.id, selectedIds: selected });
      setReport(nextReport);
      onComplete();
    } catch (err) {
      setError(err.message);
    }
  };

  if (error) return <ErrorNotice message={error} />;
  if (!detail) return <LoadingCard label="Loading red-flag content" />;
  if (report) {
    return (
      <ReportPanel
        report={report}
        onReplay={() => {
          setReport(null);
          setSelected([]);
        }}
      />
    );
  }

  return (
    <div className="module-layout">
      <aside className="list-column card">
        <span className="eyebrow">EXERCISES</span>
        {list.map((item) => (
          <button key={item.id} className={selectedId === item.id ? 'list-item selected' : 'list-item'} onClick={() => setSelectedId(item.id)}>
            <strong>{item.title}</strong>
            <span>{item.topicName} · {item.difficulty}</span>
          </button>
        ))}
      </aside>
      <div className="main-column">
        <div className="lab-layout">
          <article className="card message">
            <span className="eyebrow"><Flag size={13} /> CLICK THE RED FLAGS</span>
            <h2>{detail.title}</h2>
            <p className="hint">{detail.summary}</p>
            {detail.fragments.map((fragment) => (
              <button
                key={fragment.id}
                className={selected.includes(fragment.id) ? 'flag-text flagged' : 'flag-text'}
                onClick={() => toggle(fragment.id)}
              >
                {fragment.text}
              </button>
            ))}
          </article>
          <aside className="card score-panel">
            <div className="target-icon"><Target /></div>
            <h3>Selected signals</h3>
            <strong>{selected.length}<small> / {detail.fragments.length}</small></strong>
            <p>Focus on secrecy, urgency, verification gaps and any suggestion to bypass normal review.</p>
            <button className="primary full" onClick={submit} disabled={selected.length === 0}>
              Check my analysis
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}

function InvestigationPage({ user, onComplete, deepLink, clearDeepLink }) {
  const [cases, setCases] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listInvestigations(user.id).then((items) => {
      setCases(items);
      setSelectedId(items[0]?.id || '');
    }).catch((err) => setError(err.message));
  }, [user.id]);

  useEffect(() => {
    if (!selectedId) return;
    api.getInvestigation(user.id, selectedId).then((item) => {
      setDetail(item);
      setAttempt(null);
      setEvidence(null);
      setReport(null);
    }).catch((err) => setError(err.message));
  }, [selectedId, user.id]);

  useEffect(() => {
    if (deepLink?.type === 'investigation') {
      setSelectedId(deepLink.id);
      clearDeepLink();
    }
  }, [deepLink]);

  const startCase = async () => {
    try {
      const response = await api.startInvestigation(detail.id, user.id);
      setAttempt(response);
    } catch (err) {
      setError(err.message);
    }
  };

  const inspect = async (evidenceId) => {
    try {
      const response = await api.inspectEvidence(detail.id, {
        userId: user.id,
        attemptId: attempt.attemptId,
        evidenceId,
      });
      setAttempt((current) => ({ ...current, state: response.state }));
      setEvidence(response.evidence);
    } catch (err) {
      setError(err.message);
    }
  };

  const submit = async (finalDecisionId) => {
    try {
      const nextReport = await api.submitInvestigation(detail.id, {
        userId: user.id,
        attemptId: attempt.attemptId,
        finalDecisionId,
      });
      setReport(nextReport);
      setAttempt(null);
      onComplete();
    } catch (err) {
      setError(err.message);
    }
  };

  if (error) return <ErrorNotice message={error} />;
  if (!detail) return <LoadingCard label="Loading investigations" />;
  if (report) return <ReportPanel report={report} onReplay={() => setReport(null)} />;

  return (
    <div className="module-layout">
      <aside className="list-column card">
        <span className="eyebrow">OPEN CASES</span>
        {cases.map((item) => (
          <button key={item.id} className={selectedId === item.id ? 'list-item selected' : 'list-item'} onClick={() => setSelectedId(item.id)}>
            <strong>{item.title}</strong>
            <span>{item.riskLevel} risk · {item.topicNames.join(' · ')}</span>
          </button>
        ))}
      </aside>
      <div className="main-column">
        <div className="case-strip">
          <span className="case-icon"><BriefcaseBusiness /></span>
          <div>
            <span className="eyebrow">INVESTIGATION MODE</span>
            <h2>{detail.title}</h2>
          </div>
          <span className="tag red">{detail.riskLevel} risk</span>
        </div>
        {!attempt ? (
          <div className="investigation-grid">
            <article className="card evidence">
              <h3>Case summary</h3>
              <p>{detail.summary}</p>
              {detail.evidence.map((entry) => (
                <div key={entry.id} className="evidence-preview">
                  <b>{entry.title}</b>
                  <span>{entry.summary}</span>
                </div>
              ))}
            </article>
            <aside className="card log">
              <span className="eyebrow">READY TO START</span>
              <h3>Review before you decide</h3>
              <p>Use predefined evidence sources, then choose the safest final disposition.</p>
              <button className="primary full" onClick={startCase}>Start case</button>
            </aside>
          </div>
        ) : (
          <div className="investigation-grid">
            <article className="card evidence">
              <h3>Evidence room</h3>
              <p>{detail.summary}</p>
              {detail.evidence.map((entry) => {
                const viewed = attempt.state.reviewedEvidence.includes(entry.id);
                return (
                  <button key={entry.id} className={viewed ? 'evidence-open' : ''} onClick={() => inspect(entry.id)}>
                    <FileSearch size={18} />
                    <div>
                      <b>{entry.title}</b>
                      <span>{entry.summary}</span>
                    </div>
                    {viewed ? <Check size={18} /> : <ChevronDown size={16} />}
                  </button>
                );
              })}
              {evidence && (
                <div className="evidence-detail">
                  <strong>{evidence.title}</strong>
                  <p>{evidence.content}</p>
                </div>
              )}
            </article>
            <aside className="card log">
              <span className="eyebrow">DECISION LOG</span>
              <h3>{attempt.state.reviewedEvidence.length} evidence source(s) reviewed</h3>
              {attempt.state.decisionLog.length === 0 ? (
                <p>Open the evidence that matters before selecting the final disposition.</p>
              ) : (
                <>
                  {attempt.state.decisionLog.map((entry) => (
                    <div key={entry} className="log-entry">
                      <Check size={14} />
                      {entry}
                    </div>
                  ))}
                </>
              )}
              <div className="decision-stack">
                {detail.finalDecisions.map((decision) => (
                  <button key={decision.id} className="outline full" onClick={() => submit(decision.id)}>
                    {decision.label}
                  </button>
                ))}
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function PressurePage({ user, onComplete, deepLink, clearDeepLink }) {
  const [tests, setTests] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [started, setStarted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [selectedOption, setSelectedOption] = useState('');
  const [selectedReason, setSelectedReason] = useState('');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listPressureTests(user.id).then((items) => {
      setTests(items);
      setSelectedId(items[0]?.id || '');
    }).catch((err) => setError(err.message));
  }, [user.id]);

  useEffect(() => {
    if (!selectedId) return;
    api.getPressureTest(user.id, selectedId).then((item) => {
      setDetail(item);
      setStarted(false);
      setSeconds(item.timerSeconds);
      setSelectedOption('');
      setSelectedReason('');
      setReport(null);
    }).catch((err) => setError(err.message));
  }, [selectedId, user.id]);

  useEffect(() => {
    if (!started || seconds <= 0) {
      return undefined;
    }
    const timer = window.setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [started, seconds]);

  useEffect(() => {
    if (deepLink?.type === 'pressure-test') {
      setSelectedId(deepLink.id);
      clearDeepLink();
    }
  }, [deepLink]);

  const submit = async () => {
    try {
      const nextReport = await api.submitPressureTest(detail.id, {
        userId: user.id,
        optionId: selectedOption,
        reasoningId: selectedReason || null,
        secondsRemaining: seconds,
      });
      setReport(nextReport);
      onComplete();
    } catch (err) {
      setError(err.message);
    }
  };

  if (error) return <ErrorNotice message={error} />;
  if (!detail) return <LoadingCard label="Loading pressure tests" />;
  if (report) return <ReportPanel report={report} onReplay={() => setReport(null)} />;

  return (
    <div className="module-layout">
      <aside className="list-column card">
        <span className="eyebrow">PRESSURE TESTS</span>
        {tests.map((test) => (
          <button key={test.id} className={selectedId === test.id ? 'list-item selected' : 'list-item'} onClick={() => setSelectedId(test.id)}>
            <strong>{test.title}</strong>
            <span>{test.pressureType} · {test.topicName}</span>
          </button>
        ))}
      </aside>
      <div className="main-column">
        <div className="pressure">
          <div className="timer">
            <Clock3 />
            <b>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</b>
            <span>{started ? 'Timer is visual in this prototype.' : 'Start when ready.'}</span>
          </div>
          <div className="card pressure-card">
            <span className="tag red">{detail.pressureType}</span>
            <h2>{detail.title}</h2>
            <p>{detail.scenario}</p>
            {!started ? (
              <div className="pressure-start-panel">
                <div className="pressure-start-copy">
                  <span className="eyebrow">READY TO BEGIN</span>
                  <b>Enter the timed pressure scenario when you are ready.</b>
                  <span>The timer starts visually and the response options will open immediately.</span>
                </div>
                <button className="primary full pressure-start-button" onClick={() => setStarted(true)}>
                  <Play size={16} />
                  Start test
                </button>
              </div>
            ) : (
              <>
                {detail.options.map((option) => (
                  <button key={option.id} className={selectedOption === option.id ? 'option chosen' : 'option'} onClick={() => setSelectedOption(option.id)}>
                    <span>{String.fromCharCode(65 + detail.options.indexOf(option))}</span>
                    {option.label}
                  </button>
                ))}
                <div className="reasoning-box">
                  <span className="eyebrow">WHY DID YOU CHOOSE THIS?</span>
                  <div className="chip-row">
                    {detail.reasoningOptions.map((reason) => (
                      <button key={reason.id} className={selectedReason === reason.id ? 'filter selected' : 'filter'} onClick={() => setSelectedReason(reason.id)}>
                        {reason.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button className="primary full" disabled={!selectedOption} onClick={submit}>Submit response</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CoachPage({ user }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Tell me what happened, who is asking you to act, and what decision you need to make. I'll help identify the relevant control, the safest immediate action, and when to escalate.",
      topicName: 'Start here',
      sources: [],
    },
  ]);
  const [composer, setComposer] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef(null);

  const suggestedQuestions = [
    { topic: 'Data handling', question: 'Can I send customer data to a personal email if it is urgent?' },
    { topic: 'Customer due diligence', question: 'What should I do when beneficial ownership evidence is incomplete?' },
    { topic: 'Control pressure', question: 'A senior manager asked me to bypass a control. How should I respond?' },
    { topic: 'Third-party access', question: 'When should a vendor access request be escalated?' },
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  const sendQuestion = async (event, suggestedQuestion) => {
    event?.preventDefault();
    const question = (suggestedQuestion || composer).trim();
    if (!question || sending) return;

    const userMessage = { role: 'user', content: question };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setComposer('');
    setSending(true);
    setError('');
    try {
      const response = await api.chatWithCoach({
        userId: user.id,
        message: question,
        history: messages.slice(-4).map((message) => ({ role: message.role, content: message.content })),
      });
      setMessages([
        ...nextMessages,
        {
          role: 'assistant',
          content: response.answer,
          topicName: response.topicName,
          sources: response.sources,
          fallback: response.fallback,
        },
      ]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleComposerKeyDown = (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    sendQuestion(event);
  };

  return (
    <div className="policy-coach-layout">
      <article className="card policy-chat-panel">
        <div className="policy-chat-head">
          <div className="coach-identity">
            <div className="coach-icon"><Brain size={20} /></div>
            <div>
              <span className="eyebrow">GROUNDED POLICY SUPPORT</span>
              <h2>Ask the Policy Coach</h2>
              <p>Describe the situation in your own words. The coach will identify the control and a safe next step.</p>
            </div>
          </div>
          <div className="policy-coach-status">
            <i />
            <div>
              <strong>Ready to help</strong>
              <span>Approved guidance</span>
            </div>
          </div>
        </div>
        <div className="policy-messages" role="log" aria-live="polite" aria-label="Policy Coach conversation">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`policy-message ${message.role} ${index === 0 ? 'welcome-message' : ''}`}>
              {message.role === 'assistant' && <div className="policy-message-avatar"><Brain size={16} /></div>}
              <div className="policy-message-stack">
                <div className="policy-message-meta">
                  <strong>{message.role === 'assistant' ? 'Policy Coach' : 'You'}</strong>
                  {message.topicName && <span>{message.topicName}</span>}
                  {message.fallback && <span className="offline-guidance">Standard guidance</span>}
                </div>
                <div className="policy-message-bubble">
                  <p>{message.content}</p>
                  {message.sources?.length > 0 && (
                    <details>
                      <summary><ShieldCheck size={14} /> Guidance basis <b>{message.sources.length}</b></summary>
                      <div className="policy-source-list">
                        {message.sources.map((source) => (
                          <div key={source}><Check size={13} /><small>{source}</small></div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            </div>
          ))}
          {sending && (
            <div className="policy-message assistant loading-message">
              <div className="policy-message-avatar"><Brain size={16} /></div>
              <div className="policy-message-stack">
                <div className="policy-message-meta"><strong>Policy Coach</strong><span>Reviewing guidance</span></div>
                <div className="policy-message-bubble policy-typing" aria-label="Policy Coach is responding"><i /><i /><i /></div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        {error && <div className="policy-error"><ErrorNotice message={error} /></div>}
        <form className="policy-composer" onSubmit={sendQuestion}>
          <div className="policy-composer-shell">
            <textarea
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Describe what happened, the pressure you are under, and the decision you need to make..."
              rows={2}
              aria-label="Message the Policy Coach"
            />
            <div className="policy-composer-actions">
              <span><ShieldCheck size={13} /> Grounded in approved guidance</span>
              <span className="composer-shortcut">Shift + Enter for a new line</span>
              <button className="primary" disabled={!composer.trim() || sending} aria-label="Send question to Policy Coach">
                <Send size={16} /> {sending ? 'Reviewing' : 'Send'}
              </button>
            </div>
          </div>
        </form>
      </article>

      <aside className="card policy-coach-aside">
        <div className="policy-aside-head">
          <div className="policy-aside-icon"><Sparkles size={18} /></div>
          <div>
            <span className="eyebrow">START A CONVERSATION</span>
            <h3>Common situations</h3>
            <p>Choose a prompt or describe what happened in your own words.</p>
          </div>
        </div>
        <div className="policy-suggestion-list">
          {suggestedQuestions.map(({ topic, question }, index) => (
            <button key={question} onClick={(event) => sendQuestion(event, question)} disabled={sending}>
              <span className="policy-suggestion-number">{String(index + 1).padStart(2, '0')}</span>
              <span><small>{topic}</small><b>{question}</b></span>
              <ArrowRight size={15} />
            </button>
          ))}
        </div>
        <div className="policy-boundary-note">
          <ShieldAlert size={18} />
          <div>
            <strong>Know the boundary</strong>
            <p>The coach helps you find the next safe step. It does not replace Legal or Compliance approval where required.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function LearningPage({ user, onLaunch }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getLearning(user.id).then(setData).catch((err) => setError(err.message));
  }, [user.id]);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <LoadingCard label="Loading learning profile" />;

  return (
    <>
      <div className="stats">
        <MetricCard icon={Target} color="green" value={`${data.overallScore}%`} label="Overall score" />
        <MetricCard icon={Sparkles} color="violet" value={`${data.xp}`} label="Total XP" />
        <MetricCard icon={Flame} color="amber" value={`${data.streak}`} label="Current streak" />
        <MetricCard icon={BarChart3} color="blue" value={`${data.completedCount}`} label="Activities completed" />
      </div>
      <div className="dashboard-grid">
        <article className="card chart-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">RECENT SCORES</span>
              <h3>Progress over time</h3>
            </div>
            <span className="tag green">{data.level.label}</span>
          </div>
          <div className="fake-chart">
            {data.history.map((entry) => <i key={entry.label} style={{ height: `${Math.max(18, entry.score)}%` }} />)}
          </div>
          <div className="chart-labels">
            {data.history.map((entry) => <span key={entry.label}>{entry.label}</span>)}
          </div>
        </article>
        <article className="card strengths">
          <span className="eyebrow">TOPIC PERFORMANCE</span>
          <h3>Strengths and gaps</h3>
          {data.topicScores.map((topic) => (
            <div className="performance" key={topic.id}>
              <span>{topic.name}</span>
              <b>{topic.score}%</b>
              <div className="bar"><i style={{ width: `${topic.score}%` }} className={topic.score >= 85 ? 'green' : topic.score >= 70 ? '' : 'amber'} /></div>
            </div>
          ))}
        </article>
      </div>

      <div className="dashboard-grid">
        <article className="card activity">
          <div className="card-head">
            <div>
              <span className="eyebrow">DETERMINISTIC RECOMMENDATIONS</span>
              <h3>Recommended next training</h3>
            </div>
          </div>
          {data.recommendations.map((rec) => (
            <RecommendationCard
              key={rec.id}
              title={rec.title}
              reason={rec.reason}
              onClick={() => onLaunch({ id: rec.activityId, type: rec.activityType })}
            />
          ))}
        </article>
        <article className="card activity">
          <div className="card-head">
            <div>
              <span className="eyebrow">RECENT ACTIVITY</span>
              <h3>Learning history</h3>
            </div>
          </div>
          {data.activityHistory.slice(0, 6).map((entry) => (
            <div key={entry.id} className="activity-row">
              <div className={`dot ${entry.score >= 85 ? 'good' : entry.score >= 70 ? 'violet' : 'amber'}`} />
              <div>
                <b>{entry.title}</b>
                <span>{entry.type} · {entry.date} · {entry.score}%</span>
              </div>
            </div>
          ))}
        </article>
      </div>
    </>
  );
}

function AchievementsPage({ user }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getLearning(user.id).then(setData).catch((err) => setError(err.message));
  }, [user.id]);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <LoadingCard label="Loading achievements" />;

  return (
    <>
      <div className="level card">
        <div className="level-icon"><Trophy /></div>
        <div>
          <span className="eyebrow">LEVEL {data.level.number} · {data.level.label.toUpperCase()}</span>
          <h2>{data.level.xp} XP</h2>
          <div className="bar"><i style={{ width: `${data.level.progressPercent}%` }} /></div>
          <p>{data.level.nextLevelXp ? `${data.level.nextLevelXp - data.level.xp} XP until the next level.` : 'Top prototype level reached.'}</p>
        </div>
      </div>
      <h3 className="section-title">Badges</h3>
      <div className="badge-grid">
        {data.badges.map((badge) => (
          <article key={badge.id} className={badge.earned ? 'badge card' : 'badge card locked'}>
            <div><Medal size={24} /></div>
            <h3>{badge.name}</h3>
            <p>{badge.description}</p>
            {badge.earned && <span className="tag green"><Check size={12} /> Earned</span>}
          </article>
        ))}
      </div>
    </>
  );
}

function GameLibraryPage({ user, onLaunch }) {
  const [levels, setLevels] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    api.listGameScenarios(user.id).then(setLevels).catch((err) => setError(err.message));
  }, [user.id]);

  if (error) return <ErrorNotice message={error} />;

  const term = deferredSearch.trim().toLowerCase();
  const visibleLevels = levels.filter((level) => !term || [level.title, level.topicName, level.brief, level.world.scene?.name]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(term)));

  return (
    <div className="game-library">
      <div className="game-library-toolbar">
        <div>
          <span className="eyebrow">INTERACTIVE LEVELS</span>
          <h2>Choose a training environment</h2>
          <p>Each level is generated from a validated scenario definition and records its result in your learning profile.</p>
        </div>
        <label className="search game-library-search">
          <Search size={18} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search game levels" />
        </label>
      </div>

      <div className="game-level-grid">
        {visibleLevels.map((level, index) => (
          <article className="game-level-card" key={level.id}>
            <div
              className="game-level-cover"
              style={{ '--level-color': level.world.scene?.backdrop || level.world.accent }}
            >
              <div className="level-map-shape"><i /><i /><i /></div>
              <span>LEVEL {String(index + 1).padStart(2, '0')}</span>
              {level.completed && <b><Check size={14} /> Completed</b>}
            </div>
            <div className="game-level-body">
              <div className="training-card-tags">
                <span>{level.topicName}</span>
                <span>{level.difficulty}</span>
                {level.navigationMode === 'ai-assisted' && <span className="ai-route-tag">Adaptive path</span>}
              </div>
              <h3>{level.title}</h3>
              <p>{level.brief}</p>
              <div className="game-level-meta">
                <span><Clock3 size={14} /> {level.estimatedMinutes} min</span>
                <span><LayoutGrid size={14} /> {level.world.scene?.name || level.world.room}</span>
              </div>
              <button className="primary wide" onClick={() => onLaunch({ id: level.id, type: 'game-mission' })}>
                {level.completed ? 'Replay level' : 'Start level'} <Play size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function LibraryPage({ user, onLaunch }) {
  const [filters, setFilters] = useState({ topic: '', difficulty: '', trainingType: '', search: '', completed: '', recommended: '' });
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = { userId: user.id };
    if (filters.topic) params.topic = filters.topic;
    if (filters.difficulty) params.difficulty = filters.difficulty;
    if (filters.trainingType) params.trainingType = filters.trainingType;
    if (filters.search) params.search = filters.search;
    if (filters.completed) params.completed = filters.completed === 'true';
    if (filters.recommended) params.recommended = filters.recommended === 'true';
    api.getLibrary(params).then(setItems).catch((err) => setError(err.message));
  }, [filters, user.id]);

  if (error) return <ErrorNotice message={error} />;

  return (
    <>
      <div className="library-tools">
        <div className="search">
          <Search size={18} />
          <input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search scenarios and activities" />
        </div>
        <div className="filters">
          <select value={filters.trainingType} onChange={(event) => setFilters((current) => ({ ...current, trainingType: event.target.value }))}>
            <option value="">All types</option>
            <option value="simulation">Simulation</option>
            <option value="daily-challenge">Daily challenge</option>
            <option value="red-flag">Red flag</option>
            <option value="investigation">Investigation</option>
            <option value="pressure-test">Pressure test</option>
          </select>
          <select value={filters.difficulty} onChange={(event) => setFilters((current) => ({ ...current, difficulty: event.target.value }))}>
            <option value="">All difficulty</option>
            <option value="Foundational">Foundational</option>
            <option value="Intermediate">Intermediate</option>
            <option value="Advanced">Advanced</option>
          </select>
          <select value={filters.completed} onChange={(event) => setFilters((current) => ({ ...current, completed: event.target.value }))}>
            <option value="">All status</option>
            <option value="true">Completed</option>
            <option value="false">Not completed</option>
          </select>
        </div>
      </div>
      <div className="scenario-grid">
        {items.map((item) => (
          <article key={item.id} className="scenario card">
            <div className="scenario-cover">
              <LockKeyhole size={24} />
              <span>{item.difficulty}</span>
            </div>
            <div className="scenario-body">
              <span className="tag violet">{item.topicNames.join(' · ')}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <div className="scenario-meta">{item.type} · {item.estimatedMinutes} min{item.bestScore ? ` · Best ${item.bestScore}%` : ''}</div>
              <button className="outline" onClick={() => onLaunch({ id: item.id, type: item.type })}>
                {item.completed ? 'Replay' : 'Start'} <Play size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function ManagerPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.getManagerSummary(),
      api.getManagerDepartments(),
      api.getManagerHeatmap(),
      api.getManagerGaps(),
      api.getManagerActivities(),
    ]).then(([summary, departments, heatmap, gaps, activities]) => {
      setData({ summary, departments, heatmap, gaps, activities });
    }).catch((err) => setError(err.message));
  }, []);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <LoadingCard label="Loading manager insights" />;

  return (
    <>
      <div className="stats">
        <MetricCard icon={Users} color="blue" value={`${data.summary.totalEmployees}`} label="Employees" />
        <MetricCard icon={Target} color="green" value={`${data.summary.averageLearningScore}%`} label="Average learning score" />
        <MetricCard icon={ShieldAlert} color="amber" value={data.summary.topWeakTopic} label="Top weak topic" />
        <MetricCard icon={Clock3} color="violet" value={`${data.summary.averageDailyTrainingTime} min`} label="Average daily training time" />
      </div>

      <div className="dashboard-grid">
        <article className="card heatmap">
          <span className="eyebrow">TEAM HEATMAP</span>
          <h3>Topic score comparison</h3>
          <div className="heatmap-table">
            <div className="heatmap-head">
              <span>Department</span>
              <span>AML</span>
              <span>Privacy</span>
              <span>Sanctions</span>
              <span>Market Abuse</span>
              <span>Conduct</span>
            </div>
            {data.heatmap.map((row) => (
              <div className="heatmap-row" key={row.department}>
                <span>{row.department}</span>
                <span>{row.aml}%</span>
                <span>{row['data-privacy']}%</span>
                <span>{row.sanctions}%</span>
                <span>{row['market-abuse']}%</span>
                <span>{row['conduct-risk']}%</span>
              </div>
            ))}
          </div>
        </article>
        <article className="card gaps">
          <span className="eyebrow">COMMON LEARNING GAPS</span>
          <h3>Department campaign suggestions</h3>
          {data.gaps.map((gap) => (
            <div className="gap" key={gap.department}>
              <span>{gap.score}</span>
              <div>
                <b>{gap.department}: {gap.topic}</b>
                <p>{gap.campaignRecommendation}</p>
              </div>
            </div>
          ))}
        </article>
      </div>

      <div className="dashboard-grid">
        <article className="card activity">
          <span className="eyebrow">DEPARTMENT VIEW</span>
          <h3>Snapshot</h3>
          {data.departments.map((dept) => (
            <div key={dept.department} className="activity-row">
              <div className="dot violet" />
              <div>
                <b>{dept.department} · {dept.averageScore}%</b>
                <span>Strongest: {dept.strongestTopic} · Weakest: {dept.weakestTopic}</span>
              </div>
            </div>
          ))}
        </article>
        <article className="card activity">
          <span className="eyebrow">ACTIVITY INSIGHTS</span>
          <h3>Aggregate insights</h3>
          <div className="activity-row">
            <div className="dot amber" />
            <div><b>Most failed scenario</b><span>{data.activities.mostFailedScenario}</span></div>
          </div>
          <div className="activity-row">
            <div className="dot amber" />
            <div><b>Most missed red flag</b><span>{data.activities.mostMissedRedFlag}</span></div>
          </div>
          <div className="activity-row">
            <div className="dot good" />
            <div><b>Average investigation score</b><span>{data.activities.averageInvestigationScore}%</span></div>
          </div>
          <div className="activity-row">
            <div className="dot violet" />
            <div><b>Pressure test success rate</b><span>{data.activities.pressureTestSuccessRate}%</span></div>
          </div>
        </article>
      </div>
    </>
  );
}

function SettingsPage({ user, onReset }) {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettings(user.id).then(setSettings).catch((err) => setError(err.message));
  }, [user.id]);

  const toggle = async (key) => {
    if (!settings) return;
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    setSaving(true);
    try {
      const response = await api.updateSettings(user.id, next);
      setSettings(response);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const resetDemo = async () => {
    try {
      await api.resetDemo();
      onReset();
    } catch (err) {
      setError(err.message);
    }
  };

  if (error) return <ErrorNotice message={error} />;
  if (!settings) return <LoadingCard label="Loading settings" />;

  return (
    <div className="settings card">
      <h2>Learning preferences</h2>
      <p>Control reminders, focus mode and prototype reset behaviour.</p>
      {[
        ['dailyReminder', 'Daily challenge reminder', 'Receive a nudge to complete the daily challenge.'],
        ['weeklyRecap', 'Weekly learning recap', 'Show a weekly progress summary in the prototype.'],
        ['focusMode', 'Focus mode', 'Reduce comparison-heavy UI and keep the experience individual-first.'],
      ].map(([key, title, description]) => (
        <div className="setting" key={key}>
          <div>
            <b>{title}</b>
            <span>{description}</span>
          </div>
          <button className={settings[key] ? 'toggle on' : 'toggle'} onClick={() => toggle(key)} disabled={saving}>
            <i />
          </button>
        </div>
      ))}
      <div className="setting reset-row">
        <div>
          <b>Reset demo progress</b>
          <span>Remove live attempts, scores and settings while keeping seeded history for the prototype.</span>
        </div>
        <button className="outline" onClick={resetDemo}>
          <RefreshCcw size={15} />
          Reset
        </button>
      </div>
    </div>
  );
}

function ReportPanel({ report, onReplay, onHome }) {
  return (
    <div className="result-layout">
      <article className="card result-panel">
        <span className="eyebrow">ACTIVITY COMPLETE</span>
        <h2>{report.title}</h2>
        <div className="result-metrics">
          <div><strong>{report.score}%</strong><span>Score</span></div>
          <div><strong>{report.performanceLabel}</strong><span>Performance</span></div>
          <div><strong>{Math.round(report.timeTakenSeconds / 60)} min</strong><span>Time taken</span></div>
          <div><strong>{report.xpAwarded} XP</strong><span>Experience</span></div>
        </div>
        {report.topicScores && (
          <div className="tag-row left">
            {report.topicScores.map((topic) => <span className="tag violet" key={topic.id}>{topic.name}: {topic.score}%</span>)}
          </div>
        )}
        <div className="report-section">
          <h3>Decision journey</h3>
          <div className="journey-list">
            {(report.decisionJourney || []).map((entry, index) => (
              <div key={index} className="journey-item">
                <div className="journey-index">{index + 1}</div>
                <div>
                  <strong>{typeof entry === 'string' ? entry : entry.prompt || entry.selected}</strong>
                  {typeof entry !== 'string' && <span>{entry.selected || entry.result}</span>}
                  {typeof entry !== 'string' && entry.consequence && <p>{entry.consequence}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
        {report.identified && (
          <div className="dashboard-grid">
            <InsightList title="Red flags identified" items={report.identified.map((item) => `${item.label}: ${item.explanation}`)} />
            <InsightList title="Missed or false positives" items={[...(report.missed || []).map((item) => `${item.label}: ${item.explanation}`), ...(report.falsePositives || []).map((item) => `False positive: ${item.text}`)]} />
          </div>
        )}
        {!report.identified && (
          <div className="dashboard-grid">
            <InsightList title="What you did well" items={report.whatYouDidWell || ['This attempt has no highlighted positives yet.']} />
            <InsightList title="What you missed" items={report.whatYouMissed || ['No misses were recorded for this attempt.']} />
          </div>
        )}
        {report.whyWrongFeltReasonable && (
          <div className="report-section muted-panel">
            <h3>Why the wrong option felt reasonable</h3>
            <p>{report.whyWrongFeltReasonable}</p>
          </div>
        )}
        {report.correctDecision && (
          <div className="report-section">
            <h3>Correct decision</h3>
            <p>{report.correctDecision}</p>
          </div>
        )}
        {report.potentialConsequences && (
          <div className="tag-row left">
            {report.potentialConsequences.map((item) => <span className="tag amber" key={item}>{item}</span>)}
          </div>
        )}
        {report.replayInsights && (
          <div className="stats compact">
            <MetricCard icon={LayoutGrid} color="blue" value={`${report.replayInsights.pathsExplored || 0}`} label="Paths explored" />
            <MetricCard icon={Target} color="green" value={`${report.replayInsights.pathsAvailable || 0}`} label="Paths available" />
            <MetricCard icon={Award} color="violet" value={`${report.replayInsights.bestOutcomeDiscovered || report.score}%`} label="Best outcome" />
            <MetricCard icon={Check} color="amber" value={`${report.replayInsights.correctSteps || 0}`} label="Correct steps" />
          </div>
        )}
        <div className="report-section takeaway">
          <h3>Key takeaway</h3>
          <p>{report.keyTakeaway}</p>
        </div>
        <div className="actions-bar">
          {onReplay && <button className="primary" onClick={onReplay}><RefreshCcw size={16} /> Replay</button>}
          {onHome && <button className="outline" onClick={onHome}>Return to workspace</button>}
        </div>
      </article>
    </div>
  );
}

function TopbarAiStatus({ aiStatus }) {
  const loading = !aiStatus;
  const ready = aiStatus?.status === 'ok';
  return (
    <div className={loading ? 'ops-status' : ready ? 'ops-status ready' : 'ops-status down'}>
      <span className="status-dot" />
      <div>
        <strong>{loading ? 'Checking AI' : ready ? 'Model Ready' : 'Fallback Mode'}</strong>
        <span>{loading ? 'Verifying Ollama and model status' : ready ? `${aiStatus.models?.length || 0} model(s) available` : 'Live AI unavailable'}</span>
      </div>
    </div>
  );
}

function AiStatusSummary({ aiStatus }) {
  const loading = !aiStatus;
  const ready = aiStatus?.status === 'ok';
  return (
    <div className={loading ? 'sidebar-status' : ready ? 'sidebar-status ready' : 'sidebar-status down'}>
      <div className="sidebar-status-head">
        <span className="status-dot" />
        <b>{loading ? 'Checking AI engine' : ready ? 'AI engine ready' : 'Fallback mode'}</b>
      </div>
      <span>{loading ? 'Loading live simulation readiness.' : ready ? 'Live simulation can start from the workspace.' : 'Support tools remain available while AI is offline.'}</span>
    </div>
  );
}

function StatusListItem({ label, value, tone }) {
  return (
    <div className="status-item">
      <span>{label}</span>
      <b className={`tone-${tone}`}>{value}</b>
    </div>
  );
}

function TimelineTurn({ turn }) {
  const learner = turn.turnKind === 'learner';
  return (
    <article className={learner ? 'card timeline-turn learner' : 'card timeline-turn system'}>
      <div className="timeline-meta">
        <span className="eyebrow">{learner ? 'YOUR RESPONSE' : turn.actor}</span>
        <span>{learner ? 'Learner turn' : turn.turnKind === 'system' ? 'Scenario update' : turn.turnKind}</span>
      </div>
      <p>{turn.content}</p>
      {turn.artifact && (
        <div className="timeline-artifact">
          <div className="artifact-head">
            <span className="eyebrow">Artifact</span>
            <span className="tag">{turn.artifact.type}</span>
          </div>
          <b>{turn.artifact.title}</b>
          <p>{turn.artifact.content}</p>
        </div>
      )}
      {turn.evaluation && (
        <div className="timeline-evaluation">
          <div className="evaluation-score">
            <strong>{turn.evaluation.score}%</strong>
            <span>{turn.evaluation.label}</span>
          </div>
          <InsightMini title="Strengths" items={turn.evaluation.strengths} />
          <InsightMini title="Gaps" items={turn.evaluation.gaps} />
        </div>
      )}
    </article>
  );
}

function InsightMini({ title, items }) {
  return (
    <div className="insight-mini">
      <span className="eyebrow">{title}</span>
      {(items || []).slice(0, 3).map((item) => (
        <div key={item} className="workspace-bullet">{item}</div>
      ))}
    </div>
  );
}

function InsightList({ title, items }) {
  return (
    <article className="card mini-panel">
      <h3>{title}</h3>
      {items.length === 0 ? <p className="muted">Nothing recorded yet.</p> : items.map((item) => (
        <div key={item} className="list-line">{item}</div>
      ))}
    </article>
  );
}

function MetricCard({ icon: Icon, color, value, label }) {
  return (
    <article className="stat card">
      <div className={`stat-icon ${color}`}><Icon size={19} /></div>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </article>
  );
}

function RecommendationCard({ title, reason, onClick }) {
  const onKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div className="recommendation-card" role="button" tabIndex={0} onClick={onClick} onKeyDown={onKeyDown}>
      <div className="dot violet" />
      <div>
        <b>{title}</b>
        <span>{reason}</span>
      </div>
      <ArrowRight size={16} />
    </div>
  );
}

function AnswerBlock({ label, value }) {
  return (
    <div className="answer-block">
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

function LoadingCard({ label }) {
  return (
    <div className="loading-card card">
      <Sparkles size={18} />
      <span>{label}</span>
    </div>
  );
}

function ErrorNotice({ message }) {
  return (
    <div className="error-card card">
      <AlertTriangle size={18} />
      <span>{message}</span>
    </div>
  );
}

function Toast({ message }) {
  return <div className="toast">{message}</div>;
}

function ClipboardIcon(props) {
  return <Medal {...props} />;
}

function CircleMarker() {
  return <div className="question-marker" />;
}

function normalizePageName(page) {
  if (page === 'Simulations') {
    return 'Legacy Scenarios';
  }
  if (page === 'Compliance Coach') {
    return 'Policy Coach';
  }
  if (page === 'Manager Dashboard') {
    return 'Manager Insights';
  }
  if (page === 'Home') {
    return 'My Training';
  }
  return page;
}

function difficultyLabel(value) {
  return AI_DIFFICULTIES.find((item) => item.id === value)?.label || value;
}

function topicNameFromId(topicId) {
  return AI_TOPICS.find((topic) => topic.id === topicId)?.name || topicId || 'Topic';
}

function initials(name) {
  return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

createRoot(document.getElementById('root')).render(<App />);
