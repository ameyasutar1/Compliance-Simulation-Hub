import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { createOfficeMissionScene } from './officeMissionScene';

export function OfficeMissionGame({ missions, autoStartMissionId, onStartMission, onDecision, onComplete, onError }) {
  const mountRef = useRef(null);
  const callbacksRef = useRef({ onStartMission, onDecision, onComplete, onError });

  callbacksRef.current = { onStartMission, onDecision, onComplete, onError };

  useEffect(() => {
    if (!mountRef.current || !missions.length) return undefined;

    const Scene = createOfficeMissionScene({
      missions,
      autoStartMissionId,
      onStartMission: (...args) => callbacksRef.current.onStartMission(...args),
      onDecision: (...args) => callbacksRef.current.onDecision(...args),
      onComplete: (...args) => callbacksRef.current.onComplete(...args),
      onError: (...args) => callbacksRef.current.onError(...args),
    });

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: mountRef.current,
      backgroundColor: '#0a1420',
      width: 1200,
      height: 720,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      render: { antialias: true, pixelArt: false },
      scene: [Scene],
    });

    return () => {
      game.destroy(true);
    };
  }, [missions]);

  return <div className="phaser-mount" ref={mountRef} aria-label="Interactive compliance office mission game" />;
}
