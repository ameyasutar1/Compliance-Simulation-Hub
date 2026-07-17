import Phaser from "phaser";
import "./styles.css";
import { scenarios } from "./scenarios";

const palette = {
  shell: 0x101418,
  header: 0x202a33,
  floor: 0x27323a,
  floorLine: 0x3a4852,
  panel: 0xf5f7f9,
  panelAlt: 0xe9eef4,
  card: 0xffffff,
  ink: "#172234",
  muted: "#687589",
  softText: "#dbe5ef",
  teal: 0x19a88c,
  tealText: "#087866",
  amber: 0xe8a72d,
  amberText: "#9b6711",
  red: 0xde5b4d,
  redText: "#a23d33",
  blue: 0x4673d7,
  purple: 0x7b61d1,
  white: "#ffffff",
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function scoreLabel(score) {
  if (score >= 82) return "Control Commander";
  if (score >= 58) return "Developing Operator";
  return "Risk Review Needed";
}

class ComplianceGameScene extends Phaser.Scene {
  constructor() {
    super("ComplianceGame");
    this.mode = "title";
    this.scenarioIndex = 0;
    this.stepIndex = 0;
    this.score = 0;
    this.control = 74;
    this.timer = 0;
    this.soundOn = true;
    this.feedback = null;
    this.layout = null;
    this.packet = null;
    this.avatar = null;
    this.timerFill = null;
    this.timerLabel = null;
    this.busy = false;
  }

  create() {
    this.scale.on("resize", () => this.render());
    this.input.keyboard?.on("keydown-SPACE", () => {
      if (this.mode === "feedback") this.nextStep();
      if (this.mode === "summary") this.restart();
    });
    this.render();
  }

  update(_, delta) {
    if (this.mode !== "playing" || this.busy) return;
    this.timer = Math.max(0, this.timer - delta / 1000);
    this.updateTimer();
    this.updatePacket();
    if (this.timer <= 0) {
      this.choose({
        label: "No control applied before the release deadline.",
        score: -18,
        control: -22,
        feedback: "The request reached the release gate without a documented control decision.",
      });
    }
  }

  get scenario() {
    return scenarios[this.scenarioIndex];
  }

  get step() {
    return this.scenario.steps[this.stepIndex];
  }

  startScenario(index = 0) {
    this.scenarioIndex = index;
    this.stepIndex = 0;
    this.score = 0;
    this.control = 74;
    this.feedback = null;
    this.mode = "playing";
    this.busy = false;
    this.resetTimer();
    this.render();
    this.playCue("start");
    this.speak(`${this.scenario.title}. ${this.scenario.brief}`);
  }

  resetTimer() {
    this.timer = this.scenario.timeLimit;
  }

  choose(choice) {
    if (this.mode !== "playing" || this.busy) return;
    this.busy = true;
    this.score = clamp(this.score + choice.score, 0, 100);
    this.control = clamp(this.control + choice.control, 0, 100);
    this.feedback = choice;

    const positive = choice.score > 0;
    const station = this.layout?.escalation ?? { x: 0, y: 0 };
    this.playCue(positive ? "good" : "bad");
    this.tweens.add({
      targets: this.avatar,
      x: station.x,
      y: station.y - 48,
      duration: 360,
      ease: "Sine.easeInOut",
      onComplete: () => this.animateConsequence(positive),
    });
  }

  animateConsequence(positive) {
    if (!this.layout || !this.packet) return;
    const gate = this.layout.release;
    if (positive) {
      this.makeShield(gate.x - 54, gate.y);
      this.tweens.add({
        targets: this.packet,
        x: gate.x - 96,
        y: gate.y - 20,
        scaleX: 1.08,
        scaleY: 1.08,
        duration: 330,
        yoyo: true,
        ease: "Back.easeOut",
        onComplete: () => {
          this.burst(gate.x - 70, gate.y - 14, palette.teal, 22);
          this.finishChoice();
        },
      });
      return;
    }

    this.tweens.add({
      targets: this.packet,
      x: gate.x,
      y: gate.y - 20,
      angle: 9,
      duration: 420,
      ease: "Cubic.easeIn",
      onComplete: () => {
        this.flashRisk(gate.x, gate.y);
        this.finishChoice();
      },
    });
  }

  finishChoice() {
    this.time.delayedCall(520, () => {
      this.mode = "feedback";
      this.busy = false;
      this.render();
    });
  }

  nextStep() {
    if (this.stepIndex < this.scenario.steps.length - 1) {
      this.stepIndex += 1;
      this.feedback = null;
      this.mode = "playing";
      this.busy = false;
      this.resetTimer();
      this.render();
      this.playCue("tick");
      return;
    }

    if (this.scenarioIndex < scenarios.length - 1) {
      this.scenarioIndex += 1;
      this.stepIndex = 0;
      this.feedback = null;
      this.mode = "playing";
      this.busy = false;
      this.resetTimer();
      this.render();
      this.playCue("start");
      this.speak(`${this.scenario.title}. ${this.scenario.brief}`);
      return;
    }

    this.mode = "summary";
    this.busy = false;
    this.feedback = null;
    this.render();
    this.playCue("complete");
    this.speak(`Run complete. Final score ${this.score}. ${scoreLabel(this.score)}.`);
  }

  restart() {
    this.mode = "title";
    this.scenarioIndex = 0;
    this.stepIndex = 0;
    this.score = 0;
    this.control = 74;
    this.feedback = null;
    this.busy = false;
    window.speechSynthesis?.cancel();
    this.render();
  }

  render() {
    this.children.removeAll(true);
    this.tweens.killAll();
    this.timerFill = null;
    this.timerLabel = null;
    this.packet = null;
    this.avatar = null;
    this.drawShell();

    if (this.mode === "title") {
      this.drawTitle();
      return;
    }

    if (this.mode === "summary") {
      this.drawSummary();
      return;
    }

    this.drawGame();
  }

  drawShell() {
    const { width, height } = this.scale;
    const g = this.add.graphics();
    g.fillStyle(palette.shell, 1).fillRect(0, 0, width, height);
    g.fillStyle(palette.header, 1).fillRect(0, 0, width, 82);
    g.lineStyle(1, 0x3d4a54, 1).lineBetween(0, 82, width, 82);
  }

  drawTitle() {
    const { width, height } = this.scale;
    const compact = width < 760;
    const pad = compact ? 18 : 42;
    const titleSize = compact ? 36 : 58;
    const contentW = Math.min(width - pad * 2, 1040);
    const x = (width - contentW) / 2;
    const y = compact ? 118 : 126;

    this.text(pad, 24, "Compliance Arcade", 21, palette.white, 800);
    this.button(width - pad - 128, 24, 128, 34, this.soundOn ? "Sound On" : "Sound Off", palette.teal, () => {
      this.soundOn = !this.soundOn;
      window.speechSynthesis?.cancel();
      this.render();
    });

    this.text(x, y, "Stop The Risk Packet", titleSize, palette.white, 900, contentW);
    this.text(
      x,
      y + titleSize + 14,
      "A 2D compliance operations game. Requests move across the floor toward release; apply the right controls before they pass the gate.",
      compact ? 16 : 19,
      palette.softText,
      500,
      contentW
    );

    this.drawTitleAnimation(x, y + titleSize + 90, contentW, compact ? 100 : 130);

    const cardsY = y + titleSize + (compact ? 220 : 260);
    const cardH = compact ? 78 : 88;
    scenarios.forEach((scenario, index) => {
      const rowY = cardsY + index * (cardH + 12);
      this.panel(x, rowY, contentW, cardH, 0x202832, 0x3b4854);
      this.text(x + 18, rowY + 14, scenario.title, compact ? 18 : 22, palette.white, 800, contentW - 210);
      this.text(x + 18, rowY + 45, `${scenario.domain} | ${scenario.risk}`, 14, palette.softText, 600, contentW - 210);
      this.button(
        x + contentW - 142,
        rowY + cardH / 2 - 19,
        118,
        38,
        index === 0 ? "Play" : "Practice",
        index === 0 ? palette.teal : palette.amber,
        () => this.startScenario(index)
      );
    });
  }

  drawTitleAnimation(x, y, w, h) {
    this.panel(x, y, w, h, 0x1a2229, 0x31404b);
    const laneY = y + h / 2;
    const g = this.add.graphics();
    g.lineStyle(5, 0x40505c, 1).lineBetween(x + 34, laneY, x + w - 34, laneY);
    this.drawStation(x + 64, laneY, "Intake", palette.blue);
    this.drawStation(x + w / 2, laneY, "Controls", palette.teal);
    this.drawStation(x + w - 78, laneY, "Gate", palette.red);
    for (let i = 0; i < 4; i += 1) {
      const packet = this.makePacket(x + 110 + i * 74, laneY - 18, 0.85, false);
      this.tweens.add({
        targets: packet,
        x: x + w - 140,
        duration: 2800 + i * 420,
        delay: i * 180,
        repeat: -1,
        yoyo: true,
        ease: "Sine.easeInOut",
      });
    }
  }

  drawGame() {
    const { width, height } = this.scale;
    const compact = width < 960;
    this.drawHud();

    if (compact) {
      const pad = 14;
      const floorH = Math.max(300, height * 0.46);
      this.layout = this.drawOpsFloor(pad, 98, width - pad * 2, floorH);
      this.drawDecisionPanel(pad, 112 + floorH, width - pad * 2, height - floorH - 128);
    } else {
      const pad = 24;
      const top = 104;
      const gap = 18;
      const rightW = Math.min(460, Math.max(380, width * 0.31));
      this.layout = this.drawOpsFloor(pad, top, width - pad * 2 - rightW - gap, height - top - 22);
      this.drawDecisionPanel(width - pad - rightW, top, rightW, height - top - 22);
    }

    this.updatePacket();
  }

  drawHud() {
    const { width } = this.scale;
    const pad = width < 760 ? 16 : 24;
    this.text(pad, 18, "Compliance Arcade", 20, palette.white, 850);
    this.text(pad, 48, `${this.scenario.domain} | ${this.scenarioIndex + 1}/${scenarios.length}`, 13, palette.softText, 700);
    this.hudStat(width - pad - 332, 19, "Score", `${this.score}`);
    this.hudStat(width - pad - 218, 19, "Control", `${this.control}%`);
    this.button(width - pad - 112, 24, 112, 34, this.soundOn ? "Audio" : "Muted", 0x303b45, () => {
      this.soundOn = !this.soundOn;
      window.speechSynthesis?.cancel();
      this.render();
    });
  }

  drawOpsFloor(x, y, w, h) {
    this.panel(x, y, w, h, palette.floor, 0x455560);
    this.drawFloorGrid(x, y, w, h);

    const laneY = y + h * 0.5;
    const intake = { x: x + w * 0.12, y: laneY };
    const evidence = { x: x + w * 0.33, y: y + h * 0.28 };
    const escalation = { x: x + w * 0.58, y: y + h * 0.72 };
    const release = { x: x + w * 0.86, y: laneY };

    const g = this.add.graphics();
    g.lineStyle(10, 0x53636e, 1);
    g.lineBetween(intake.x, intake.y, release.x, release.y);
    g.lineStyle(3, 0x9dafba, 0.55);
    g.lineBetween(intake.x, intake.y, release.x, release.y);

    this.drawStation(intake.x, intake.y, "Intake", palette.blue);
    this.drawStation(evidence.x, evidence.y, "Evidence", palette.amber);
    this.drawStation(escalation.x, escalation.y, "Escalate", palette.teal);
    this.drawGate(release.x, release.y);
    this.drawAvatar(evidence.x, evidence.y + 76);
    this.packet = this.makePacket(intake.x, intake.y - 20, 1, true);

    this.text(x + 18, y + 18, this.scenario.title, 26, palette.white, 850, w - 36);
    this.text(x + 18, y + 56, this.step.event, 16, palette.softText, 500, w - 36);
    this.drawRiskMeter(x + 18, y + h - 68, w - 36);
    this.drawTimerBar(x + 18, y + h - 32, w - 36);

    return { x, y, w, h, intake, evidence, escalation, release };
  }

  drawFloorGrid(x, y, w, h) {
    const g = this.add.graphics();
    g.lineStyle(1, palette.floorLine, 0.4);
    for (let gx = x + 24; gx < x + w; gx += 32) g.lineBetween(gx, y, gx, y + h);
    for (let gy = y + 24; gy < y + h; gy += 32) g.lineBetween(x, gy, x + w, gy);
  }

  drawStation(x, y, label, color) {
    const g = this.add.graphics();
    g.fillStyle(0x1b2229, 1).fillRoundedRect(x - 50, y - 34, 100, 68, 8);
    g.lineStyle(2, color, 1).strokeRoundedRect(x - 50, y - 34, 100, 68, 8);
    g.fillStyle(color, 1).fillCircle(x, y - 8, 10);
    this.text(x - 46, y + 12, label, 13, palette.white, 800, 92, "center");
  }

  drawGate(x, y) {
    const g = this.add.graphics();
    g.fillStyle(0x351f22, 1).fillRoundedRect(x - 44, y - 58, 88, 116, 8);
    g.lineStyle(3, palette.red, 1).strokeRoundedRect(x - 44, y - 58, 88, 116, 8);
    g.fillStyle(palette.red, 1).fillRect(x - 26, y - 36, 52, 10);
    g.fillRect(x - 26, y - 6, 52, 10);
    g.fillRect(x - 26, y + 24, 52, 10);
    this.text(x - 44, y + 66, "Release", 13, palette.white, 850, 88, "center");
  }

  drawAvatar(x, y) {
    const body = this.add.container(x, y);
    const g = this.add.graphics();
    g.fillStyle(0x233244, 1).fillRoundedRect(-18, -18, 36, 38, 10);
    g.fillStyle(0xf1c6a6, 1).fillCircle(0, -30, 14);
    g.fillStyle(palette.teal, 1).fillCircle(-7, -34, 3).fillCircle(7, -34, 3);
    g.lineStyle(3, 0xf1c6a6, 1).lineBetween(-20, -8, -34, 8).lineBetween(20, -8, 34, 8);
    g.lineStyle(4, 0x31465d, 1).lineBetween(-9, 20, -15, 40).lineBetween(9, 20, 15, 40);
    body.add(g);
    this.text(x - 42, y + 44, "You", 13, palette.softText, 800, 84, "center");
    this.avatar = body;
    this.tweens.add({
      targets: body,
      y: y - 5,
      duration: 760,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  makePacket(x, y, scale = 1, animate = true) {
    const packet = this.add.container(x, y);
    packet.setScale(scale);
    const g = this.add.graphics();
    g.fillStyle(0xfff6d8, 1).fillRoundedRect(-34, -22, 68, 44, 7);
    g.lineStyle(2, 0xd99b2e, 1).strokeRoundedRect(-34, -22, 68, 44, 7);
    g.lineStyle(2, 0xd99b2e, 1).lineBetween(-30, -16, 0, 4).lineBetween(30, -16, 0, 4);
    g.fillStyle(palette.red, 1).fillCircle(26, -17, 7);
    packet.add(g);
    if (animate) {
      this.tweens.add({
        targets: packet,
        y: y - 7,
        angle: 2,
        duration: 560,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
    return packet;
  }

  drawRiskMeter(x, y, w) {
    const risk = 100 - this.control;
    this.text(x, y - 20, "Risk Pressure", 12, palette.softText, 800);
    const g = this.add.graphics();
    g.fillStyle(0x1b252d, 1).fillRoundedRect(x, y, w, 12, 6);
    g.fillStyle(risk > 58 ? palette.red : risk > 32 ? palette.amber : palette.teal, 1).fillRoundedRect(x, y, w * (risk / 100), 12, 6);
  }

  drawTimerBar(x, y, w) {
    const g = this.add.graphics();
    g.fillStyle(0x1b252d, 1).fillRoundedRect(x, y, w, 12, 6);
    this.timerFill = this.add.graphics();
    this.timerLabel = this.text(x, y + 16, "", 12, palette.softText, 800);
    this.updateTimer();
  }

  updateTimer() {
    if (!this.timerFill || !this.timerLabel) return;
    const track = this.layout;
    if (!track) return;
    const ratio = clamp(this.timer / this.scenario.timeLimit, 0, 1);
    const x = track.x + 18;
    const y = track.y + track.h - 32;
    const w = track.w - 36;
    const color = ratio > 0.45 ? palette.teal : ratio > 0.18 ? palette.amber : palette.red;
    this.timerFill.clear();
    this.timerFill.fillStyle(color, 1).fillRoundedRect(x, y, Math.max(5, w * ratio), 12, 6);
    this.timerLabel.setText(`${Math.ceil(this.timer)}s until auto-release`);
    this.timerLabel.setColor(ratio > 0.18 ? palette.softText : palette.redText);
  }

  updatePacket() {
    if (!this.packet || !this.layout) return;
    const p = clamp(1 - this.timer / this.scenario.timeLimit, 0, 1);
    const from = this.layout.intake;
    const to = this.layout.release;
    this.packet.x = lerp(from.x, to.x - 72, p);
    this.packet.y = lerp(from.y - 20, to.y - 20, p) + Math.sin(this.time.now / 160) * 4;
  }

  drawDecisionPanel(x, y, w, h) {
    this.panel(x, y, w, h, palette.panel, 0xd6dde6);
    this.text(x + 18, y + 16, "Current Artifact", 12, palette.muted, 850);
    this.text(x + 18, y + 40, this.scenario.artifact.title, 22, palette.ink, 850, w - 36);
    this.text(x + 18, y + 78, this.scenario.artifact.body, 15, palette.muted, 500, w - 36);
    this.divider(x + 18, y + 142, w - 36);

    if (this.mode === "feedback") {
      this.drawFeedback(x + 18, y + 164, w - 36, h - 182);
      return;
    }

    this.text(x + 18, y + 162, this.step.prompt, 23, palette.ink, 850, w - 36);
    const choiceTop = y + 214;
    const available = Math.max(190, h - 238);
    const choiceH = clamp(Math.floor((available - 22) / 3), 56, 82);
    this.step.choices.forEach((choice, index) => {
      this.choiceButton(x + 18, choiceTop + index * (choiceH + 11), w - 36, choiceH, choice, index);
    });
  }

  choiceButton(x, y, w, h, choice, index) {
    const fill = index === 0 ? 0xffffff : index === 1 ? 0xf0faf7 : 0xfffbef;
    const stroke = index === 0 ? 0xd8dee8 : index === 1 ? 0xa9dbd0 : 0xefd49e;
    this.panel(x, y, w, h, fill, stroke);
    const zone = this.add.zone(x, y, w, h).setOrigin(0).setInteractive({ useHandCursor: true });
    zone.on("pointerover", () => {
      const g = this.add.graphics();
      g.lineStyle(3, index === 1 ? palette.teal : palette.amber, 1).strokeRoundedRect(x, y, w, h, 8);
    });
    zone.on("pointerout", () => this.render());
    zone.on("pointerup", () => this.choose(choice));
    this.text(x + 16, y + 12, choice.label, 15, palette.ink, 750, w - 32);
  }

  drawFeedback(x, y, w, h) {
    const positive = this.feedback.score > 0;
    const fill = positive ? 0xe9f7f3 : 0xffeeee;
    const stroke = positive ? 0x98d6c9 : 0xf0b2ad;
    const accent = positive ? palette.teal : palette.red;
    const textColor = positive ? palette.tealText : palette.redText;

    this.panel(x, y, w, Math.min(220, h - 64), fill, stroke);
    this.text(x + 16, y + 16, positive ? "Control Blocked The Risk" : "Risk Passed The Gate", 21, textColor, 900, w - 32);
    this.text(x + 16, y + 56, this.feedback.feedback, 16, palette.ink, 550, w - 32);
    this.text(x + 16, y + 134, `Score ${this.feedback.score > 0 ? "+" : ""}${this.feedback.score}`, 15, textColor, 850);
    this.text(x + 132, y + 134, `Control ${this.feedback.control > 0 ? "+" : ""}${this.feedback.control}`, 15, textColor, 850);
    this.button(x, y + Math.min(242, h - 52), w, 48, "Continue", accent, () => this.nextStep());
  }

  makeShield(x, y) {
    const shield = this.add.graphics();
    shield.lineStyle(4, palette.teal, 1);
    shield.fillStyle(0x19a88c, 0.16);
    shield.fillRoundedRect(x - 34, y - 70, 68, 112, 18);
    shield.strokeRoundedRect(x - 34, y - 70, 68, 112, 18);
    this.tweens.add({
      targets: shield,
      alpha: 0,
      scaleX: 1.25,
      scaleY: 1.25,
      duration: 900,
      ease: "Cubic.easeOut",
      onComplete: () => shield.destroy(),
    });
  }

  flashRisk(x, y) {
    const g = this.add.graphics();
    g.fillStyle(palette.red, 0.28).fillCircle(x, y, 24);
    this.tweens.add({
      targets: g,
      alpha: 0,
      scaleX: 5,
      scaleY: 5,
      duration: 740,
      ease: "Cubic.easeOut",
      onComplete: () => g.destroy(),
    });
    this.burst(x, y, palette.red, 26);
  }

  burst(x, y, color, count) {
    for (let i = 0; i < count; i += 1) {
      const dot = this.add.circle(x, y, Phaser.Math.Between(3, 7), color, 1);
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.Between(34, 110);
      this.tweens.add({
        targets: dot,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scale: 0.2,
        duration: Phaser.Math.Between(420, 850),
        ease: "Cubic.easeOut",
        onComplete: () => dot.destroy(),
      });
    }
  }

  drawSummary() {
    const { width, height } = this.scale;
    const pad = width < 760 ? 20 : 42;
    const w = Math.min(width - pad * 2, 880);
    const x = (width - w) / 2;
    const y = Math.max(120, height * 0.17);

    this.text(pad, 24, "Compliance Arcade", 21, palette.white, 850);
    this.panel(x, y, w, Math.min(450, height - y - 42), palette.panel, 0xd6dde6);
    this.text(x + 28, y + 28, "Run Complete", 13, palette.muted, 850);
    this.text(x + 28, y + 60, scoreLabel(this.score), 42, palette.ink, 900, w - 56);
    this.text(x + 28, y + 124, `Final score ${this.score}. Control integrity ${this.control}%.`, 20, palette.ink, 800, w - 56);
    this.text(
      x + 28,
      y + 176,
      "You handled moving requests, pressure, and artifacts across data privacy, AML, and third-party risk. Strong runs block the packet before release and document the control path.",
      17,
      palette.muted,
      500,
      w - 56
    );
    this.button(x + 28, y + 272, Math.min(230, w - 56), 52, "Play again", palette.teal, () => this.restart());
  }

  hudStat(x, y, label, value) {
    this.text(x, y, label, 11, palette.softText, 800);
    this.text(x, y + 18, value, 20, palette.white, 850);
  }

  panel(x, y, w, h, fill = palette.card, stroke = 0xd8dee8) {
    const g = this.add.graphics();
    g.fillStyle(fill, 1).fillRoundedRect(x, y, w, h, 8);
    g.lineStyle(1, stroke, 1).strokeRoundedRect(x, y, w, h, 8);
    return g;
  }

  button(x, y, w, h, label, fill, onClick) {
    const g = this.add.graphics();
    g.fillStyle(fill, 1).fillRoundedRect(x, y, w, h, 8);
    const zone = this.add.zone(x, y, w, h).setOrigin(0).setInteractive({ useHandCursor: true });
    zone.on("pointerover", () => {
      g.clear();
      g.fillStyle(fill, 1).fillRoundedRect(x, y - 1, w, h + 2, 8);
      g.lineStyle(2, 0xffffff, 0.4).strokeRoundedRect(x, y - 1, w, h + 2, 8);
    });
    zone.on("pointerout", () => {
      g.clear();
      g.fillStyle(fill, 1).fillRoundedRect(x, y, w, h, 8);
    });
    zone.on("pointerup", onClick);
    this.text(x, y + h / 2 - 9, label, 15, palette.white, 850, w, "center");
  }

  divider(x, y, w) {
    const g = this.add.graphics();
    g.lineStyle(1, 0xd8dee8, 1).lineBetween(x, y, x + w, y);
  }

  text(x, y, value, size, color, weight = 500, width = 360, align = "left") {
    return this.add.text(x, y, value, {
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      fontSize: `${size}px`,
      fontStyle: weight >= 700 ? "bold" : "normal",
      color,
      align,
      lineSpacing: 6,
      wordWrap: { width, useAdvancedWrap: true },
    });
  }

  playCue(kind) {
    if (!this.soundOn) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.audioContext ??= new AudioContext();
    const ctx = this.audioContext;
    if (ctx.state === "suspended") ctx.resume();
    const tones = {
      start: [360, 0.1],
      good: [680, 0.09],
      bad: [170, 0.14],
      tick: [440, 0.06],
      complete: [760, 0.16],
    };
    const [frequency, duration] = tones[kind] || tones.tick;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = frequency;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  speak(text) {
    if (!this.soundOn || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 0.9;
    utterance.volume = 0.72;
    window.speechSynthesis.speak(utterance);
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  backgroundColor: "#101418",
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  render: {
    antialias: true,
    pixelArt: false,
  },
  scene: [ComplianceGameScene],
});

window.complianceGame = game;
