import React, { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
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
  GraduationCap,
  Home,
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
import './styles.css';

const NAV = [
  ['Home', Home],
  ['Daily Challenge', Flame],
  ['Simulations', Play],
  ['Red Flag Lab', Flag],
  ['Investigations', FileSearch],
  ['Pressure Tests', Gauge],
  ['Compliance Coach', Brain],
  ['My Learning', BarChart3],
  ['Achievements', Trophy],
  ['Scenario Library', LayoutGrid],
];

const PAGE_INFO = {
  Home: ['Compliance Simulation Hub', 'Train judgement through realistic compliance decisions.'],
  'Daily Challenge': ['Daily Challenge', 'A short exercise mapped to today and your current learning needs.'],
  Simulations: ['Scenario Simulations', 'Branch through realistic cases, consequences and replay paths.'],
  'Red Flag Lab': ['Red Flag Lab', 'Spot suspicious wording before it becomes a control failure.'],
  Investigations: ['Investigation Mode', 'Review evidence, build a case and choose a defensible outcome.'],
  'Pressure Tests': ['Pressure Tests', 'Stay principled when the clock, client or hierarchy is pushing back.'],
  'Compliance Coach': ['Compliance Coach', 'Browse predefined, rule-based compliance explanations and reminders.'],
  'My Learning': ['My Learning', 'Track topic scores, progress, gaps and next-best training actions.'],
  Achievements: ['Achievements', 'Professional gamification that rewards learning discipline and improvement.'],
  'Scenario Library': ['Scenario Library', 'Browse all available training activities with filters and completion history.'],
  'Manager Dashboard': ['Manager Dashboard', 'See aggregate learning performance, gaps and recommended campaigns.'],
  Settings: ['Settings', 'Manage reminders, focus preferences and demo reset controls.'],
};

const TYPE_TO_PAGE = {
  simulation: 'Simulations',
  'daily-challenge': 'Daily Challenge',
  'red-flag': 'Red Flag Lab',
  investigation: 'Investigations',
  'pressure-test': 'Pressure Tests',
};

function App() {
  const [page, setPage] = useState('Home');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [toast, setToast] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [deepLink, setDeepLink] = useState(null);

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

  const navigate = (nextPage) => {
    startTransition(() => {
      setPage(nextPage);
      setMobileOpen(false);
    });
  };

  const handleLogin = async (userId) => {
    const response = await api.login(userId);
    window.localStorage.setItem('compliance-user-id', userId);
    setUser(response.user);
    setPage(response.user.isManager ? 'Manager Dashboard' : 'Home');
    setToast(`Signed in as ${response.user.name}`);
  };

  const handleLogout = () => {
    window.localStorage.removeItem('compliance-user-id');
    setUser(null);
    setPage('Home');
    setDeepLink(null);
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

  const [title, subtitle] = PAGE_INFO[page] || PAGE_INFO.Home;

  return (
    <div className="app">
      <Sidebar
        mobileOpen={mobileOpen}
        page={page}
        user={user}
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
          {page === 'Home' && (
            <DashboardPage
              key={`home-${refreshKey}`}
              user={user}
              onLaunch={handleLaunch}
              onNavigate={navigate}
            />
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
          {page === 'Simulations' && (
            <SimulationsPage
              key={`sim-${refreshKey}`}
              user={user}
              onComplete={() => handleActivityComplete('Simulation progress updated.')}
              deepLink={deepLink}
              clearDeepLink={clearDeepLink}
              onNavigate={navigate}
            />
          )}
          {page === 'Red Flag Lab' && (
            <RedFlagPage
              key={`flag-${refreshKey}`}
              user={user}
              onComplete={() => handleActivityComplete('Red flag results saved.')}
              deepLink={deepLink}
              clearDeepLink={clearDeepLink}
            />
          )}
          {page === 'Investigations' && (
            <InvestigationPage
              key={`invest-${refreshKey}`}
              user={user}
              onComplete={() => handleActivityComplete('Investigation outcome saved.')}
              deepLink={deepLink}
              clearDeepLink={clearDeepLink}
            />
          )}
          {page === 'Pressure Tests' && (
            <PressurePage
              key={`pressure-${refreshKey}`}
              user={user}
              onComplete={() => handleActivityComplete('Pressure test recorded.')}
              deepLink={deepLink}
              clearDeepLink={clearDeepLink}
            />
          )}
          {page === 'Compliance Coach' && <CoachPage />}
          {page === 'My Learning' && <LearningPage key={`learning-${refreshKey}`} user={user} onLaunch={handleLaunch} />}
          {page === 'Achievements' && <AchievementsPage key={`badges-${refreshKey}`} user={user} />}
          {page === 'Scenario Library' && (
            <LibraryPage
              key={`library-${refreshKey}`}
              user={user}
              onLaunch={handleLaunch}
            />
          )}
          {page === 'Manager Dashboard' && user.isManager && <ManagerPage key={`manager-${refreshKey}`} />}
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
            <span>Compliance Simulation Hub</span>
            <strong>Static Rule-Based Prototype</strong>
          </div>
        </div>
        <h1>Practise compliance decisions, not just policy recall.</h1>
        <p>
          Enter realistic workplace pressure, make the call, see the consequence, and let the
          rule-based learning engine update your profile.
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
              {submitting ? 'Signing in...' : 'Enter prototype'}
            </button>
          </form>
        )}
      </div>
      <div className="login-showcase">
        <div className="hero card">
          <span className="eyebrow"><Sparkles size={14} /> RULE-BASED LEARNING LOOP</span>
          <h2>Practise. Decide. Learn. Reinforce.</h2>
          <p>
            Static scenarios, deterministic scoring, replay insights, activity history, coach answers,
            and manager-level gaps are all wired through APIs so future AI modules can swap in cleanly.
          </p>
          <div className="hero-meta">
            <span><Brain size={15} /> No AI in V1</span>
            <span><BarChart3 size={15} /> SQLite persistence</span>
            <span><ShieldCheck size={15} /> Manager aggregate views</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ mobileOpen, onClose, onNavigate, onLogout, page, user }) {
  return (
    <aside className={mobileOpen ? 'sidebar open' : 'sidebar'}>
      <div className="brand">
        <div className="brand-mark"><ShieldAlert size={18} /></div>
        <div>
          <span>Compliance</span>
          <strong>Simulation Hub</strong>
        </div>
        <button className="icon mobile-close" onClick={onClose}>
          <X />
        </button>
      </div>
      <div className="nav">
        {NAV.map(([label, Icon]) => (
          <button key={label} className={page === label ? 'active' : ''} onClick={() => onNavigate(label)}>
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
        {user.isManager && (
          <>
            <div className="nav-label">LEADERSHIP</div>
            <button className={page === 'Manager Dashboard' ? 'active' : ''} onClick={() => onNavigate('Manager Dashboard')}>
              <Users size={18} />
              <span>Manager Dashboard</span>
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

function DashboardPage({ user, onLaunch, onNavigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getDashboard(user.id).then(setData).catch((err) => setError(err.message));
  }, [user.id]);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <LoadingCard label="Loading dashboard" />;

  return (
    <>
      <div className="hero">
        <div className="hero-orb" />
        <span className="eyebrow"><Sparkles size={14} /> TODAY'S 5-MINUTE CHALLENGE</span>
        <h2>{data.greeting}</h2>
        <p>{data.dailyChallenge.title}</p>
        <div className="hero-meta">
          <span><Clock3 size={15} /> {data.dailyChallenge.estimatedMinutes} min</span>
          <span><Target size={15} /> {data.dailyChallenge.topic}</span>
          <span><ShieldCheck size={15} /> {data.currentLearningFocus.name}: {data.currentLearningFocus.label}</span>
        </div>
        <div className="hero-actions">
          <button className="primary" onClick={() => onLaunch({ id: data.dailyChallenge.id, type: 'daily-challenge' })}>
            <Play size={16} />
            Start challenge
          </button>
          <button className="outline ghost" onClick={() => onNavigate('My Learning')}>
            View learning profile
          </button>
        </div>
      </div>

      <div className="stats">
        <MetricCard icon={Target} color="green" value={`${data.learningSummary.overallScore}%`} label="Learning score" />
        <MetricCard icon={Flame} color="amber" value={`${data.learningSummary.streak}`} label="Current streak" />
        <MetricCard icon={ClipboardIcon} color="blue" value={`${data.learningSummary.scenariosCompleted}`} label="Scenario completions" />
        <MetricCard icon={Award} color="violet" value={`${data.learningSummary.badgesEarned}`} label="Badges earned" />
      </div>

      <div className="dashboard-grid">
        <article className="card progress-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">LEARNING FOCUS</span>
              <h3>Topic reinforcement</h3>
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
              <span className="eyebrow">RULE-BASED RECOMMENDATIONS</span>
              <h3>What to do next</h3>
            </div>
          </div>
          {data.recommendations.map((rec) => (
            <button key={rec.id} className="activity-row action-row" onClick={() => onLaunch({ id: rec.activityId, type: rec.activityType })}>
              <div className="dot violet" />
              <div>
                <b>{rec.title}</b>
                <span>{rec.reason}</span>
              </div>
              <ArrowRight size={16} />
            </button>
          ))}
        </article>
      </div>

      <h3 className="section-title">Choose your training mode</h3>
      <div className="mode-grid">
        {data.trainingModes.map((mode) => (
          <button key={mode.id} className="mode card" onClick={() => onNavigate(mode.id)}>
            <div className="mode-icon violet"><Play size={18} /></div>
            <b>{mode.label}</b>
            <span>{mode.description}</span>
            <span className="arrow">Explore</span>
          </button>
        ))}
      </div>

      <h3 className="section-title">Recent activity</h3>
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
        onHome={() => onNavigate('Home')}
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
              <span className="eyebrow">DECISION {index + 1}</span>
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
        onHome={() => onNavigate('Home')}
      />
    );
  }

  if (active) {
    const node = active.node;
    return (
      <div className="simulation">
        <button className="back" onClick={() => setActive(null)}>← Back to simulations</button>
        <div className="sim-layout">
          <article className="email card">
            <div className="email-top">
              <div className="mail-icon"><Mail size={18} /></div>
              <div>
                <h2>{active.scenario.title}</h2>
                <span>{node.time} · {node.location}</span>
              </div>
            </div>
            <div className="detail-grid">
              <div><strong>Speaker</strong><span>{node.speaker}</span></div>
              <div><strong>Channel</strong><span>{node.channel}</span></div>
            </div>
            <p className="context-line">{node.context}</p>
            <p className="email-body">{node.content}</p>
            {node.supportingDocument && <div className="supporting-doc">{node.supportingDocument}</div>}
          </article>

          <aside className="decision card">
            <span className="eyebrow">STEP {node.step} OF {active.scenario.nodes.length}</span>
            <h3>What is the best next step?</h3>
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
            {node.reasoningOptions?.length > 0 && (
              <div className="reasoning-box">
                <span className="eyebrow">OPTIONAL REASONING</span>
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
            {!consequence ? (
              <button className="primary full" disabled={!selectedOption} onClick={submitDecision}>
                Submit decision
              </button>
            ) : (
              <div className="feedback">
                <b>Consequence</b>
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
                  Continue →
                </button>
              </div>
            )}
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
          <b>Six branching simulations seeded for the prototype.</b>
          <span>Each one routes through a fixed decision tree, score rules and replay metrics.</span>
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
              <button className="primary" onClick={() => setStarted(true)}>
                <Play size={16} />
                Start test
              </button>
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

function CoachPage() {
  const [topics, setTopics] = useState([]);
  const [selectedTopic, setSelectedTopic] = useState('');
  const [questions, setQuestions] = useState([]);
  const [answer, setAnswer] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    api.getCoachTopics().then((response) => {
      setTopics(response);
      setSelectedTopic(response[0]?.id || '');
    }).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!selectedTopic && !deferredSearch) {
      return;
    }
    const loader = deferredSearch.trim()
      ? api.searchCoach(deferredSearch.trim())
      : api.getCoachQuestions(selectedTopic);
    loader.then(setQuestions).catch((err) => setError(err.message));
  }, [selectedTopic, deferredSearch]);

  const loadAnswer = async (questionId) => {
    try {
      const response = await api.getCoachAnswer(questionId);
      setAnswer(response);
    } catch (err) {
      setError(err.message);
    }
  };

  if (error) return <ErrorNotice message={error} />;

  return (
    <div className="coach-layout">
      <aside className="card coach-topics">
        <span className="eyebrow">TOPICS</span>
        {topics.map((topic) => (
          <button key={topic.id} className={selectedTopic === topic.id ? 'selected' : ''} onClick={() => { setSelectedTopic(topic.id); setSearch(''); }}>
            {topic.plainName}
            <ChevronDown size={15} />
          </button>
        ))}
      </aside>
      <article className="card coach-chat">
        <div className="coach-title">
          <div className="coach-icon"><Brain /></div>
          <div>
            <h2>Compliance Coach</h2>
            <p>Static, predefined answers only. No AI in this version.</p>
          </div>
        </div>
        <div className="coach-search">
          <Search size={18} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search predefined compliance questions" />
        </div>
        <div className="question-list">
          {questions.map((question) => (
            <button key={question.id} className="coach-question" onClick={() => loadAnswer(question.id)}>
              <CircleMarker />
              <div>
                <b>{question.question}</b>
                <span>{question.topicName}</span>
              </div>
            </button>
          ))}
        </div>
        {answer && (
          <div className="coach-answer-panel">
            <h3>{answer.question}</h3>
            <div className="answer-grid">
              <AnswerBlock label="Simple explanation" value={answer.answer.simpleExplanation} />
              <AnswerBlock label="Example" value={answer.answer.example} />
              <AnswerBlock label="Common mistake" value={answer.answer.commonMistake} />
              <AnswerBlock label="Recommended action" value={answer.answer.recommendedAction} />
              <AnswerBlock label="Remember this" value={answer.answer.remember} />
            </div>
          </div>
        )}
      </article>
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
            <button key={rec.id} className="activity-row action-row" onClick={() => onLaunch({ id: rec.activityId, type: rec.activityType })}>
              <div className="dot violet" />
              <div>
                <b>{rec.title}</b>
                <span>{rec.reason}</span>
              </div>
              <ArrowRight size={16} />
            </button>
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
  if (!data) return <LoadingCard label="Loading manager analytics" />;

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
          <span className="eyebrow">DEPARTMENT HEATMAP</span>
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
          <span className="eyebrow">COMMON KNOWLEDGE GAPS</span>
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
          <span className="eyebrow">ACTIVITY PERFORMANCE</span>
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
          {onHome && <button className="outline" onClick={onHome}>Return Home</button>}
        </div>
      </article>
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

function initials(name) {
  return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

createRoot(document.getElementById('root')).render(<App />);
