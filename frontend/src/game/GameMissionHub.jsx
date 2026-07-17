import React, { useEffect, useState } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { api } from '../api';
import { OfficeMissionGame } from './OfficeMissionGame';

export function GameMissionHub({ user, initialScenarioId, onComplete }) {
  const [missions, setMissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastReport, setLastReport] = useState(null);

  const loadMissions = () => {
    setLoading(true);
    setError('');
    api.listGameScenarios(user.id)
      .then((response) => {
        const selected = initialScenarioId
          ? response.filter((mission) => mission.id === initialScenarioId)
          : response;
        setMissions(selected.length ? selected : response);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(loadMissions, [user.id, initialScenarioId]);

  const startMission = async (scenarioId) => {
    setError('');
    setLastReport(null);
    return api.startGameSession({ userId: user.id, scenarioId });
  };

  const submitDecision = (attemptId, nodeId, choiceId) => api.submitGameDecision(attemptId, {
    userId: user.id,
    nodeId,
    choiceId,
  });

  const handleComplete = (report) => {
    setLastReport(report);
    loadMissions();
    onComplete?.(report);
  };

  if (loading && !missions.length) {
    return (
      <div className="game-loading card">
        <LoaderCircle className="spin" size={22} />
        <span>Preparing the operations floor...</span>
      </div>
    );
  }

  if (error && !missions.length) {
    return (
      <div className="game-error card">
        <AlertTriangle size={22} />
        <div><strong>Mission hub unavailable</strong><p>{error}</p></div>
        <button className="outline" onClick={loadMissions}>Try again</button>
      </div>
    );
  }

  return (
    <div className="game-page">
      {error && <div className="game-inline-error"><AlertTriangle size={16} /> {error}</div>}

      <div className="game-frame card">
        <OfficeMissionGame
          missions={missions}
          autoStartMissionId={initialScenarioId}
          onStartMission={startMission}
          onDecision={submitDecision}
          onComplete={handleComplete}
          onError={(message) => setError(message)}
        />
      </div>

      {lastReport && (
        <div className="game-result-ribbon card">
          <div>
            <span className="eyebrow">MISSION RECORDED</span>
            <strong>{lastReport.title}</strong>
          </div>
          <div><b>{lastReport.score}%</b><span>{lastReport.performanceLabel}</span></div>
          <div><b>+{lastReport.xpAwarded} XP</b><span>Learning profile updated</span></div>
        </div>
      )}
    </div>
  );
}

export default GameMissionHub;
