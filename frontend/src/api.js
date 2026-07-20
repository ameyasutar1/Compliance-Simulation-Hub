const defaultApiBase = (() => {
  if (typeof window === 'undefined') {
    return 'http://127.0.0.1:8000/api';
  }

  if (window.location.port === '5173') {
    return 'http://127.0.0.1:8000/api';
  }

  return `${window.location.origin}/api`;
})();

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? defaultApiBase;

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  if (!response.ok) {
    const fallback = { detail: 'Request failed' };
    const error = await response.json().catch(() => fallback);
    throw new Error(error.detail || fallback.detail);
  }

  return response.json();
}

export const api = {
  getAiStatus: () => request('/ai/status'),
  startAiSimulation: (payload) => request('/ai/simulations', { method: 'POST', body: JSON.stringify(payload) }),
  getAiSimulation: (sessionId, userId) => request(`/ai/simulations/${sessionId}?userId=${encodeURIComponent(userId)}`),
  submitAiSimulationTurn: (sessionId, payload) => request(`/ai/simulations/${sessionId}/turns`, { method: 'POST', body: JSON.stringify(payload) }),
  listGameScenarios: (userId) => request(`/game/scenarios?userId=${encodeURIComponent(userId)}`),
  getTrainingAssignments: (userId) => request(`/training/assignments?userId=${encodeURIComponent(userId)}`),
  startGameSession: (payload) => request('/game/sessions', { method: 'POST', body: JSON.stringify(payload) }),
  getGameSession: (attemptId, userId) => request(`/game/sessions/${attemptId}?userId=${encodeURIComponent(userId)}`),
  submitGameDecision: (attemptId, payload) => request(`/game/sessions/${attemptId}/decisions`, { method: 'POST', body: JSON.stringify(payload) }),
  getUsers: () => request('/users'),
  login: (userId) => request('/login', { method: 'POST', body: JSON.stringify({ userId }) }),
  getUser: (userId) => request(`/users/${userId}`),
  getDashboard: (userId) => request(`/dashboard/${userId}`),
  getDailyChallenge: (userId) => request(`/daily-challenge?userId=${encodeURIComponent(userId)}`),
  submitDailyChallenge: (challengeId, payload) => request(`/daily-challenge/${challengeId}/submit`, { method: 'POST', body: JSON.stringify(payload) }),
  listScenarios: (userId) => request(`/scenarios?userId=${encodeURIComponent(userId)}`),
  getScenario: (userId, scenarioId) => request(`/scenarios/${scenarioId}?userId=${encodeURIComponent(userId)}`),
  startScenario: (scenarioId, userId) => request(`/scenarios/${scenarioId}/attempts`, { method: 'POST', body: JSON.stringify({ userId }) }),
  submitScenarioDecision: (scenarioId, payload) => request(`/scenarios/${scenarioId}/decisions`, { method: 'POST', body: JSON.stringify(payload) }),
  listRedFlags: (userId) => request(`/red-flags?userId=${encodeURIComponent(userId)}`),
  getRedFlag: (userId, activityId) => request(`/red-flags/${activityId}?userId=${encodeURIComponent(userId)}`),
  submitRedFlags: (activityId, payload) => request(`/red-flags/${activityId}/submit`, { method: 'POST', body: JSON.stringify(payload) }),
  listInvestigations: (userId) => request(`/investigations?userId=${encodeURIComponent(userId)}`),
  getInvestigation: (userId, caseId) => request(`/investigations/${caseId}?userId=${encodeURIComponent(userId)}`),
  startInvestigation: (caseId, userId) => request(`/investigations/${caseId}/attempts`, { method: 'POST', body: JSON.stringify({ userId }) }),
  inspectEvidence: (caseId, payload) => request(`/investigations/${caseId}/action`, { method: 'POST', body: JSON.stringify(payload) }),
  submitInvestigation: (caseId, payload) => request(`/investigations/${caseId}/submit`, { method: 'POST', body: JSON.stringify(payload) }),
  listPressureTests: (userId) => request(`/pressure-tests?userId=${encodeURIComponent(userId)}`),
  getPressureTest: (userId, testId) => request(`/pressure-tests/${testId}?userId=${encodeURIComponent(userId)}`),
  submitPressureTest: (testId, payload) => request(`/pressure-tests/${testId}/submit`, { method: 'POST', body: JSON.stringify(payload) }),
  getCoachTopics: () => request('/coach/topics'),
  getCoachQuestions: (topicId) => request(`/coach/questions${topicId ? `?topicId=${encodeURIComponent(topicId)}` : ''}`),
  getCoachAnswer: (questionId) => request(`/coach/answers/${questionId}`),
  searchCoach: (query) => request(`/coach/search?query=${encodeURIComponent(query)}`),
  chatWithCoach: (payload) => request('/coach/chat', { method: 'POST', body: JSON.stringify(payload) }),
  getLearning: (userId) => request(`/learning/${userId}`),
  getRecommendations: (userId) => request(`/learning/${userId}/recommendations`),
  getActivityHistory: (userId) => request(`/learning/${userId}/activity`),
  getBadges: (userId) => request(`/learning/${userId}/badges`),
  getLibrary: (params) => request(`/library?${new URLSearchParams(params).toString()}`),
  getManagerSummary: () => request('/manager/summary'),
  getManagerDepartments: () => request('/manager/departments'),
  getManagerHeatmap: () => request('/manager/heatmap'),
  getManagerGaps: () => request('/manager/gaps'),
  getManagerActivities: () => request('/manager/activities'),
  getSettings: (userId) => request(`/settings/${userId}`),
  updateSettings: (userId, payload) => request(`/settings/${userId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  listProjects: (userId) => request(`/projects?userId=${encodeURIComponent(userId)}`),
  getProject: (projectId, userId) => request(`/projects/${encodeURIComponent(projectId)}?userId=${encodeURIComponent(userId)}`),
  getProjectConnectors: (userId) => request(`/project-connectors?userId=${encodeURIComponent(userId)}`),
  updateProjectSource: (projectId, payload) => request(`/projects/${encodeURIComponent(projectId)}/source`, { method: 'PUT', body: JSON.stringify(payload) }),
  testProjectSource: (projectId, payload) => request(`/projects/${encodeURIComponent(projectId)}/source/test`, { method: 'POST', body: JSON.stringify(payload) }),
  getProjectSources: (projectId, userId) => request(`/projects/${encodeURIComponent(projectId)}/sources?userId=${encodeURIComponent(userId)}`),
  createProjectSource: (projectId, payload) => request(`/projects/${encodeURIComponent(projectId)}/sources`, { method: 'POST', body: JSON.stringify(payload) }),
  updateProjectResource: (projectId, sourceId, payload) => request(`/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteProjectSource: (projectId, sourceId, userId) => request(`/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE', body: JSON.stringify({ userId }) }),
  testProjectResource: (projectId, sourceId, userId) => request(`/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}/test`, { method: 'POST', body: JSON.stringify({ userId }) }),
  syncProjectResource: (projectId, sourceId, userId) => request(`/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}/sync`, { method: 'POST', body: JSON.stringify({ userId }) }),
  syncProject: (projectId, userId) => request(`/projects/${encodeURIComponent(projectId)}/sync`, { method: 'POST', body: JSON.stringify({ userId }) }),
  generateProjectCourse: (projectId, userId) => request(`/projects/${encodeURIComponent(projectId)}/courses/generate`, { method: 'POST', body: JSON.stringify({ userId }) }),
  publishProjectCourse: (projectId, courseId, userId) => request(`/projects/${encodeURIComponent(projectId)}/courses/${encodeURIComponent(courseId)}/publish`, { method: 'POST', body: JSON.stringify({ userId }) }),
  assignProject: (projectId, userId, employeeIds) => request(`/projects/${encodeURIComponent(projectId)}/assignments`, { method: 'POST', body: JSON.stringify({ userId, employeeIds }) }),
  startProjectAttempt: (projectId, userId) => request(`/projects/${encodeURIComponent(projectId)}/attempts`, { method: 'POST', body: JSON.stringify({ userId }) }),
  submitProjectAttempt: (projectId, attemptId, userId, answers) => request(`/projects/${encodeURIComponent(projectId)}/attempts/${encodeURIComponent(attemptId)}/submit`, { method: 'POST', body: JSON.stringify({ userId, answers }) }),
  resetDemo: () => request('/admin/reset-demo', { method: 'POST' }),
};
