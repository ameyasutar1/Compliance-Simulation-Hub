import Phaser from 'phaser';

const COLORS = {
  shell: 0x08131f,
  shellSoft: 0x102236,
  floor: 0xdfe7ef,
  floorAlt: 0xeaf0f5,
  wall: 0x173047,
  wallEdge: 0x294760,
  ink: '#142339',
  muted: '#667890',
  white: '#ffffff',
  blue: 0x4f70df,
  teal: 0x1c9c7e,
  amber: 0xe3a13a,
  red: 0xd4524c,
  violet: 0x745fd0,
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
// A steeper projection keeps rooms readable while retaining the compact isometric style.
const ISO = { originX: 600, originY: 145, tileWidth: 72, tileHeight: 44, columns: 14, rows: 10 };
const MISSION_SPOTS = [
  { x: 2.35, y: 3.2 },
  { x: 6.65, y: 3.25 },
  { x: 10.45, y: 9.05 },
  { x: 3.25, y: 9.05 },
];
const MISSION_SPOTS_BY_ID = {
  'game-data-export': MISSION_SPOTS[0],
  'game-payment-release': MISSION_SPOTS[1],
  'game-insider-signal': MISSION_SPOTS[2],
  'game-vendor-override': MISSION_SPOTS[3],
};

export function createOfficeMissionScene(callbacks) {
  return class OfficeMissionScene extends Phaser.Scene {
    constructor() {
      super('OfficeMissionHub');
      this.missions = callbacks.missions;
      this.callbacks = callbacks;
      this.autoStartMissionId = callbacks.autoStartMissionId;
      this.player = null;
      this.npcs = [];
      this.nearbyMission = null;
      this.overlay = null;
      this.session = null;
      this.currentNode = null;
      this.score = 50;
      this.risk = 35;
      this.soundOn = true;
      this.busy = false;
      this.lastMove = 'down';
      this.wallColliders = [];
      this.wallSegments = [];
      this.ambientActors = [];
      this.levelScene = this.missions[0]?.world?.scene || null;
      this.playerWorld = { ...(this.levelScene?.playerSpawn || { x: 7, y: 5 }) };
      this.music = null;
      this.musicOn = true;
      this.levelProgress = this.missions.filter((mission) => mission.completed).length;
    }

    preload() {
      this.load.audio('sakura-daisy', '/audio/sakura-girl-daisy.mp3');
    }

    create() {
      this.drawOffice();
      this.createAmbientLife();
      this.createPlayer();
      this.createMissionCharacters();
      this.createHud();
      this.createControls();
      this.setupMusic();
      this.cameras.main.fadeIn(450, 8, 19, 31);
      if (this.autoStartMissionId) {
        this.time.delayedCall(550, () => {
          const mission = this.missions.find((item) => item.id === this.autoStartMissionId);
          if (mission && !this.overlay) this.showMissionBrief(mission);
        });
      }
    }

    createControls() {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.keys = this.input.keyboard.addKeys({
        up: 'W', down: 'S', left: 'A', right: 'D', interact: 'E', space: 'SPACE', mute: 'M',
      });
    }

    update(_, delta) {
      if (!this.player) return;
      if (Phaser.Input.Keyboard.JustDown(this.keys.mute)) this.toggleMusic();
      this.updateAmbientActors(delta);
      if (this.overlay || this.busy) {
        this.animatePerson(this.playerBody, this.time.now / 280, false);
        return;
      }

      const left = this.cursors.left.isDown || this.keys.left.isDown;
      const right = this.cursors.right.isDown || this.keys.right.isDown;
      const up = this.cursors.up.isDown || this.keys.up.isDown;
      const down = this.cursors.down.isDown || this.keys.down.isDown;
      let dx = Number(right) - Number(left);
      let dy = Number(down) - Number(up);
      if (dx || dy) {
        const length = Math.hypot(dx, dy);
        dx /= length;
        dy /= length;
        const step = 3.2 * (delta / 1000);
        this.movePlayer(dx, dy, step);
        this.animatePerson(this.playerBody, this.time.now / 105, true);
        this.playerShadow.scaleX = 1 + Math.sin(this.time.now / 90) * 0.08;
        this.lastMove = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      } else {
        this.animatePerson(this.playerBody, this.time.now / 280, false);
        this.playerShadow.scaleX += (1 - this.playerShadow.scaleX) * 0.2;
      }

      this.updateNearbyMission();
      if (
        this.nearbyMission
        && (Phaser.Input.Keyboard.JustDown(this.keys.interact) || Phaser.Input.Keyboard.JustDown(this.keys.space))
      ) {
        this.showMissionBrief(this.nearbyMission);
      }
    }

    isoToScreen(worldX, worldY) {
      return {
        x: ISO.originX + (worldX - worldY) * (ISO.tileWidth / 2),
        y: ISO.originY + (worldX + worldY) * (ISO.tileHeight / 2),
      };
    }

    movePlayer(screenDx, screenDy, step) {
      const worldDx = (screenDx + screenDy) * 0.5 * step;
      const worldDy = (screenDy - screenDx) * 0.5 * step;
      const nextX = clamp(this.playerWorld.x + worldDx, 0.45, ISO.columns - 0.45);
      if (!this.collidesWithWall(nextX, this.playerWorld.y)) this.playerWorld.x = nextX;
      const nextY = clamp(this.playerWorld.y + worldDy, 0.45, ISO.rows - 0.45);
      if (!this.collidesWithWall(this.playerWorld.x, nextY)) this.playerWorld.y = nextY;
      const screen = this.isoToScreen(this.playerWorld.x, this.playerWorld.y);
      this.player.setPosition(screen.x, screen.y);
      this.player.setDepth(Math.round(screen.y + 80));
      this.ensureMusicPlaying();
    }

    collidesWithWall(x, y) {
      return this.wallSegments.some((wall) => {
        const dx = wall.x2 - wall.x1;
        const dy = wall.y2 - wall.y1;
        const lengthSquared = dx * dx + dy * dy;
        const progress = lengthSquared
          ? clamp(((x - wall.x1) * dx + (y - wall.y1) * dy) / lengthSquared, 0, 1)
          : 0;
        const nearestX = wall.x1 + progress * dx;
        const nearestY = wall.y1 + progress * dy;
        return Math.hypot(x - nearestX, y - nearestY) < 0.24;
      });
    }

    sceneColor(value, fallback) {
      if (!value) return fallback;
      return Phaser.Display.Color.HexStringToColor(value).color;
    }

    drawOffice() {
      this.wallColliders = [];
      this.wallSegments = [];
      const scene = this.levelScene;
      const backdrop = this.add.graphics();
      const backdropColor = this.sceneColor(scene?.backdrop, 0x86b8a8);
      const backdropAccent = this.sceneColor(scene?.backdropAccent, 0xa7cec0);
      backdrop.fillStyle(backdropColor, 1).fillRect(0, 0, 1200, 720);
      backdrop.fillStyle(0x315e65, 0.12).fillCircle(95, 620, 220);
      backdrop.fillStyle(backdropAccent, 0.45).fillCircle(1120, 205, 260);
      this.drawIsoFloor();

      const boundaryWalls = [
        [0, 0, ISO.columns, 0],
        [ISO.columns, 0, ISO.columns, ISO.rows],
        [ISO.columns, ISO.rows, 0, ISO.rows],
        [0, ISO.rows, 0, 0],
      ];
      boundaryWalls.forEach((segment) => this.drawIsoWall(...segment, false));

      const defaultWalls = [
        [5, 0, 5, 4], [9, 0, 9, 4], [6, 6, 6, 10],
        [0, 4, 2.1, 4], [3.0, 4, 6.5, 4], [7.45, 4, 11.0, 4], [11.9, 4, 14, 4],
        [0, 6, 2.65, 6], [3.55, 6, 9.75, 6], [10.7, 6, 14, 6],
      ];
      const internalWalls = scene
        ? scene.walls.map((wall) => [wall.x1, wall.y1, wall.x2, wall.y2])
        : defaultWalls;
      internalWalls.forEach((segment) => this.drawIsoWall(...segment, true));

      const defaultRooms = [
        { x: 1.1, y: 0.55, label: 'OPERATIONS', accent: '#3c78d8' },
        { x: 5.65, y: 0.55, label: 'COMPLIANCE', accent: '#e29a2f' },
        { x: 9.65, y: 0.55, label: 'CLIENT MEETING', accent: '#775dc8' },
        { x: 0.8, y: 6.55, label: 'TECH SUPPORT', accent: '#1b9b7c' },
        { x: 6.7, y: 6.55, label: 'TRADING FLOOR', accent: '#d9515f' },
      ];
      (scene?.rooms?.length ? scene.rooms : defaultRooms).forEach((room) => {
        this.drawIsoRoomLabel(room.x, room.y, room.label, this.sceneColor(room.accent, COLORS.blue));
      });

      const defaultFurniture = [
        { type: 'desk', x: 1.1, y: 1.25, accent: '#3d86d7' },
        { type: 'desk', x: 3.15, y: 2.35, accent: '#3d86d7' },
        { type: 'desk', x: 5.45, y: 1.35, accent: '#e3a137' },
        { type: 'desk', x: 7.4, y: 2.45, accent: '#e3a137' },
        { type: 'meeting-table', x: 11.15, y: 2.1 },
        { type: 'server', x: 0.75, y: 7.2, accent: '#1d3b50' },
        { type: 'server', x: 1.55, y: 8.1, accent: '#1d3b50' },
        { type: 'desk', x: 4.1, y: 8.0, accent: '#2ca98b' },
        { type: 'desk', x: 7.0, y: 7.15, accent: '#3f6bd7' },
        { type: 'desk', x: 9.15, y: 8.35, accent: '#d34f5c' },
        { type: 'desk', x: 11.35, y: 7.15, accent: '#3f6bd7' },
        { type: 'plant', x: 0.65, y: 3.4 },
        { type: 'plant', x: 8.3, y: 3.35 },
        { type: 'plant', x: 13.1, y: 9.0 },
      ];
      (scene?.furniture?.length ? scene.furniture : defaultFurniture).forEach((item) => {
        const accent = this.sceneColor(item.accent, COLORS.blue);
        if (item.type === 'desk') this.drawIsoDesk(item.x, item.y, accent);
        if (item.type === 'meeting-table') this.drawIsoMeetingTable(item.x, item.y);
        if (item.type === 'server') this.drawIsoServer(item.x, item.y, accent);
        if (item.type === 'plant') this.drawIsoPlant(item.x, item.y);
      });
    }

    drawIsoFloor() {
      const g = this.add.graphics().setDepth(0);
      const top = this.isoToScreen(0, 0);
      const right = this.isoToScreen(ISO.columns, 0);
      const bottom = this.isoToScreen(ISO.columns, ISO.rows);
      const left = this.isoToScreen(0, ISO.rows);
      g.fillStyle(0x3b6dc1, 1).fillPoints([
        { x: left.x, y: left.y + 18 }, { x: bottom.x, y: bottom.y + 18 }, bottom, left,
      ], true);
      g.fillStyle(0x28579f, 1).fillPoints([
        { x: right.x, y: right.y }, { x: bottom.x, y: bottom.y }, { x: bottom.x, y: bottom.y + 18 }, { x: right.x, y: right.y + 18 },
      ], true);
      g.fillStyle(0x13355d, 0.18).fillPoints([
        { x: left.x + 12, y: left.y + 27 }, { x: bottom.x + 12, y: bottom.y + 27 },
        { x: bottom.x + 34, y: bottom.y + 39 }, { x: left.x + 34, y: left.y + 39 },
      ], true);

      for (let worldY = 0; worldY < ISO.rows; worldY += 1) {
        for (let worldX = 0; worldX < ISO.columns; worldX += 1) {
          const center = this.isoToScreen(worldX + 0.5, worldY + 0.5);
          const tileColor = this.isoTileColor(worldX, worldY);
          g.fillStyle(tileColor, 1).fillPoints([
            { x: center.x, y: center.y - ISO.tileHeight / 2 + 1 },
            { x: center.x + ISO.tileWidth / 2 - 1, y: center.y },
            { x: center.x, y: center.y + ISO.tileHeight / 2 - 1 },
            { x: center.x - ISO.tileWidth / 2 + 1, y: center.y },
          ], true);
          g.lineStyle(1, 0xffffff, 0.16).strokePoints([
            { x: center.x, y: center.y - ISO.tileHeight / 2 + 1 },
            { x: center.x + ISO.tileWidth / 2 - 1, y: center.y },
            { x: center.x, y: center.y + ISO.tileHeight / 2 - 1 },
            { x: center.x - ISO.tileWidth / 2 + 1, y: center.y },
          ], true);
        }
      }
    }

    isoTileColor(x, y) {
      const alternate = (x + y) % 2;
      if (y >= 4 && y < 6) return alternate ? 0xb9d9d6 : 0xc4e1dd;
      if (y < 4 && x < 5) return alternate ? 0xdceaf4 : 0xe7f0f7;
      if (y < 4 && x < 9) return alternate ? 0xf0e6d3 : 0xf7eddb;
      if (y < 4) return alternate ? 0xe9e1f2 : 0xf0e9f6;
      if (x < 6) return alternate ? 0xd9ebe5 : 0xe3f1ec;
      return alternate ? 0xe8e5ed : 0xf0edf3;
    }

    drawIsoWall(x1, y1, x2, y2, blocksMovement) {
      const start = this.isoToScreen(x1, y1);
      const end = this.isoToScreen(x2, y2);
      const height = 19;
      const g = this.add.graphics().setDepth(Math.round((start.y + end.y) / 2 + 38));
      g.fillStyle(0x2f67bd, 1).fillPoints([
        start, end, { x: end.x, y: end.y - height }, { x: start.x, y: start.y - height },
      ], true);
      g.lineStyle(4, 0x68a2ee, 1).lineBetween(start.x, start.y - height, end.x, end.y - height);
      g.lineStyle(2, 0xd4e7ff, 0.9).lineBetween(start.x, start.y - height - 2, end.x, end.y - height - 2);
      if (blocksMovement) this.wallSegments.push({ x1, y1, x2, y2 });
    }

    drawIsoRoomLabel(worldX, worldY, label, accent) {
      const position = this.isoToScreen(worldX, worldY);
      const width = Math.max(92, label.length * 7.5);
      const plate = this.add.graphics().setDepth(Math.round(position.y + 60));
      plate.fillStyle(0xffffff, 0.92).fillRoundedRect(position.x - width / 2, position.y - 38, width, 25, 10);
      plate.fillStyle(accent, 1).fillRoundedRect(position.x - width / 2, position.y - 38, 7, 25, 4);
      this.add.text(position.x, position.y - 25, label, {
        fontFamily: 'Manrope, sans-serif', fontSize: '10px', color: '#24415e', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(Math.round(position.y + 61));
    }

    drawIsoBox(worldX, worldY, width, depth, height, topColor, leftColor, rightColor, baseHeight = 0) {
      const a = this.isoToScreen(worldX, worldY);
      const b = this.isoToScreen(worldX + width, worldY);
      const c = this.isoToScreen(worldX + width, worldY + depth);
      const d = this.isoToScreen(worldX, worldY + depth);
      const lift = (point, amount) => ({ x: point.x, y: point.y - amount });
      const ab = lift(a, baseHeight); const bb = lift(b, baseHeight);
      const cb = lift(c, baseHeight); const db = lift(d, baseHeight);
      const at = lift(a, baseHeight + height); const bt = lift(b, baseHeight + height);
      const ct = lift(c, baseHeight + height); const dt = lift(d, baseHeight + height);
      const g = this.add.graphics().setDepth(Math.round(c.y + 70));
      g.fillStyle(leftColor, 1).fillPoints([db, cb, ct, dt], true);
      g.fillStyle(rightColor, 1).fillPoints([bb, cb, ct, bt], true);
      g.fillStyle(topColor, 1).fillPoints([at, bt, ct, dt], true);
      return {
        g,
        center: this.isoToScreen(worldX + width / 2, worldY + depth / 2),
        topY: baseHeight + height,
      };
    }

    drawIsoDesk(worldX, worldY, accent) {
      this.drawIsoBox(worldX + 0.12, worldY + 0.12, 0.16, 0.56, 18, 0x6f7f8c, 0x455661, 0x586a76);
      this.drawIsoBox(worldX + 1.27, worldY + 0.12, 0.16, 0.56, 18, 0x6f7f8c, 0x455661, 0x586a76);
      const desk = this.drawIsoBox(worldX, worldY, 1.55, 0.82, 5, 0xd8ad7b, 0x9d704d, 0xb9855b, 18);
      const screen = desk.center;
      const monitor = this.add.graphics().setDepth(Math.round(screen.y + 95));
      monitor.fillStyle(0x24394c, 1).fillRoundedRect(screen.x - 22, screen.y - 53, 44, 27, 5);
      monitor.fillStyle(accent, 1).fillRoundedRect(screen.x - 17, screen.y - 49, 34, 17, 3);
      monitor.fillStyle(0x24394c, 1).fillRect(screen.x - 3, screen.y - 26, 6, 10);
      monitor.fillStyle(0x516779, 1).fillRoundedRect(screen.x - 13, screen.y - 17, 26, 4, 2);
      monitor.fillStyle(accent, 1).fillRoundedRect(screen.x - 43, screen.y - 25, 20, 4, 2);
      this.drawIsoOfficeChair(worldX + 0.78, worldY + 1.02, accent);
    }

    drawIsoOfficeChair(worldX, worldY, accent) {
      const position = this.isoToScreen(worldX, worldY);
      const chair = this.add.graphics().setDepth(Math.round(position.y + 82));
      chair.fillStyle(0x15283a, 0.18).fillEllipse(position.x, position.y + 13, 35, 12);
      chair.lineStyle(3, 0x465a69, 1);
      chair.lineBetween(position.x, position.y + 2, position.x, position.y + 14);
      chair.lineBetween(position.x, position.y + 12, position.x - 13, position.y + 18);
      chair.lineBetween(position.x, position.y + 12, position.x + 13, position.y + 18);
      chair.fillStyle(0x314a60, 1).fillEllipse(position.x, position.y, 31, 15);
      chair.fillStyle(accent, 1).fillRoundedRect(position.x - 15, position.y - 29, 30, 23, 8);
      chair.fillStyle(0xffffff, 0.13).fillRoundedRect(position.x - 10, position.y - 25, 20, 4, 2);
    }

    drawIsoMeetingTable(worldX, worldY) {
      this.drawIsoBox(worldX + 0.25, worldY + 0.25, 0.2, 0.95, 15, 0x6f7f8c, 0x455661, 0x586a76);
      this.drawIsoBox(worldX + 1.75, worldY + 0.25, 0.2, 0.95, 15, 0x6f7f8c, 0x455661, 0x586a76);
      const table = this.drawIsoBox(worldX, worldY, 2.2, 1.45, 6, 0xd9aa75, 0x996a47, 0xb77e54, 15);
      const center = table.center;
      const chairs = [[-77, 3], [77, 3], [-40, -45], [40, 45]];
      chairs.forEach(([offsetX, offsetY]) => {
        const chair = this.add.graphics().setDepth(Math.round(center.y + offsetY + 82));
        chair.fillStyle(0x254f78, 1).fillRoundedRect(center.x + offsetX - 12, center.y + offsetY - 9, 24, 18, 6);
        chair.fillStyle(0x326da6, 1).fillRoundedRect(center.x + offsetX - 12, center.y + offsetY - 25, 24, 14, 5);
        chair.lineStyle(3, 0x314557, 1);
        chair.lineBetween(center.x + offsetX - 8, center.y + offsetY + 7, center.x + offsetX - 9, center.y + offsetY + 18);
        chair.lineBetween(center.x + offsetX + 8, center.y + offsetY + 7, center.x + offsetX + 9, center.y + offsetY + 18);
      });
    }

    drawIsoServer(worldX, worldY, color) {
      this.drawIsoBox(worldX, worldY, 0.72, 0.72, 48, color, 0x142b3c, 0x1b3447);
      const screen = this.isoToScreen(worldX + 0.36, worldY + 0.36);
      const lights = this.add.graphics().setDepth(Math.round(screen.y + 90));
      for (let index = 0; index < 4; index += 1) {
        lights.fillStyle(index % 2 ? 0x43d99e : 0xf2b840, 1).fillCircle(screen.x + 10, screen.y - 50 + index * 11, 2.5);
      }
    }

    drawIsoPlant(worldX, worldY) {
      const position = this.isoToScreen(worldX, worldY);
      const plant = this.add.graphics().setDepth(Math.round(position.y + 80));
      plant.fillStyle(0xb97242, 1).fillRoundedRect(position.x - 12, position.y - 5, 24, 26, 5);
      plant.fillStyle(0x36aa68, 1).fillEllipse(position.x - 9, position.y - 25, 19, 46);
      plant.fillStyle(0x51c879, 1).fillEllipse(position.x + 9, position.y - 30, 20, 52);
    }

    floorZone(g, x, y, w, h, first, second) {
      g.fillStyle(first, 1).fillRect(x, y, w, h);
      for (let tileX = x; tileX < x + w; tileX += 36) {
        for (let tileY = y; tileY < y + h; tileY += 36) {
          if ((Math.floor(tileX / 36) + Math.floor(tileY / 36)) % 2) {
            g.fillStyle(second, 0.58).fillRect(tileX + 1, tileY + 1, 34, 34);
          }
        }
      }
    }

    drawExteriorWalls(g) {
      this.wall(g, 42, 96, 1116, 15);
      this.wall(g, 42, 661, 1116, 15);
      this.wall(g, 42, 96, 15, 580);
      this.wall(g, 1143, 96, 15, 580);
    }

    drawTopRoom(g, x, y, w, h, label, accent, doorCenter) {
      this.wall(g, x, y, 13, h);
      this.wall(g, x + w - 13, y, 13, h);
      this.wall(g, x, y, w, 13);
      const doorWidth = 74;
      this.wall(g, x, y + h - 13, doorCenter - doorWidth / 2 - x, 13);
      this.wall(g, doorCenter + doorWidth / 2, y + h - 13, x + w - doorCenter - doorWidth / 2, 13);
      this.drawDoor(g, doorCenter, y + h, 'top');
      this.roomLabel(x + 24, y + 24, label, accent);
    }

    drawBottomRoom(g, x, y, w, h, label, accent, doorCenter) {
      this.wall(g, x, y, 13, h);
      this.wall(g, x + w - 13, y, 13, h);
      this.wall(g, x, y + h - 13, w, 13);
      const doorWidth = 74;
      this.wall(g, x, y, doorCenter - doorWidth / 2 - x, 13);
      this.wall(g, doorCenter + doorWidth / 2, y, x + w - doorCenter - doorWidth / 2, 13);
      this.drawDoor(g, doorCenter, y, 'bottom');
      this.roomLabel(x + 24, y + 26, label, accent);
    }

    wall(g, x, y, w, h) {
      if (w <= 0 || h <= 0) return;
      g.fillStyle(0x07111c, 0.22).fillRoundedRect(x + 4, y + 5, w, h, 3);
      g.fillStyle(COLORS.wall, 1).fillRoundedRect(x, y, w, h, 3);
      g.fillStyle(COLORS.wallEdge, 1).fillRoundedRect(x + 2, y + 2, Math.max(0, w - 4), Math.min(4, h - 2), 2);
      this.wallColliders.push({ x, y, w, h });
    }

    drawDoor(g, x, y, side) {
      const direction = side === 'top' ? -1 : 1;
      g.fillStyle(0x89a0b4, 0.28).fillRoundedRect(x - 38, y - 7, 76, 14, 4);
      g.lineStyle(3, 0x8b6a4d, 1).lineBetween(x - 36, y, x - 36, y + direction * 48);
      g.lineStyle(2, 0xb78c64, 0.75);
      g.beginPath();
      g.arc(x - 36, y, 48, side === 'top' ? Math.PI * 1.5 : Math.PI * 0.5, side === 'top' ? Math.PI * 2 : 0, side !== 'top');
      g.strokePath();
      g.fillStyle(0xb78c64, 1).fillRoundedRect(x - 39, y + direction * 48 - 3, 7, 52, 2);
    }

    roomLabel(x, y, label, accent) {
      const plate = this.add.graphics().setDepth(5);
      plate.fillStyle(0x102236, 0.92).fillRoundedRect(x, y, 126, 27, 7);
      plate.fillStyle(accent, 1).fillRoundedRect(x, y, 6, 27, 3);
      this.add.text(x + 15, y + 7, label, {
        fontFamily: 'Manrope, sans-serif', fontSize: '10px', color: COLORS.white, fontStyle: 'bold', letterSpacing: 0.8,
      }).setDepth(6);
    }

    drawWindowBank(g, x, y, width) {
      g.fillStyle(0x071421, 1).fillRoundedRect(x, y, width, 12, 3);
      for (let paneX = x + 6; paneX < x + width - 8; paneX += 45) {
        g.fillStyle(0x4f7392, 0.72).fillRoundedRect(paneX, y + 2, 37, 7, 2);
        g.fillStyle(0x9fd4e6, 0.4).fillRect(paneX + 4, y + 3, 13, 2);
      }
    }

    drawDesk(x, y, accent) {
      const g = this.add.graphics();
      g.fillStyle(0x07111c, 0.2).fillRoundedRect(x - 48, y - 19, 100, 54, 8);
      g.fillStyle(0x916e50, 1).fillRoundedRect(x - 50, y - 27, 100, 50, 7);
      g.fillStyle(0xbd9876, 1).fillRoundedRect(x - 46, y - 23, 92, 39, 5);
      g.fillStyle(0x1a2b3d, 1).fillRoundedRect(x - 30, y - 39, 60, 31, 5);
      g.fillStyle(accent, 0.9).fillRoundedRect(x - 25, y - 35, 50, 20, 3);
      g.fillStyle(0xe4eef5, 0.45).fillRect(x - 20, y - 31, 21, 2);
      g.fillStyle(0x26394c, 1).fillRect(x - 3, y - 8, 6, 10);
      g.fillStyle(0x2e4358, 1).fillEllipse(x, y + 43, 40, 28);
      g.lineStyle(3, 0x26394c, 1).lineBetween(x, y + 55, x, y + 65);
    }

    drawMeetingTable(x, y) {
      const g = this.add.graphics();
      g.fillStyle(0x07111c, 0.18).fillEllipse(x + 4, y + 8, 202, 98);
      g.fillStyle(0x87644b, 1).fillEllipse(x, y, 198, 96);
      g.fillStyle(0xb58e6c, 1).fillEllipse(x, y - 4, 188, 84);
      g.fillStyle(0x24394e, 1).fillRoundedRect(x - 18, y - 14, 36, 22, 5);
      for (let index = 0; index < 6; index += 1) {
        const angle = (Math.PI * 2 * index) / 6;
        g.fillStyle(0x263b50, 1).fillRoundedRect(x + Math.cos(angle) * 116 - 15, y + Math.sin(angle) * 65 - 12, 30, 24, 7);
      }
    }

    drawServerRack(x, y) {
      const g = this.add.graphics();
      g.fillStyle(0x26394b, 1).fillRoundedRect(x - 34, y - 50, 68, 100, 6);
      for (let row = 0; row < 4; row += 1) {
        g.fillStyle(0x101d2a, 1).fillRoundedRect(x - 26, y - 39 + row * 22, 52, 15, 3);
        g.fillStyle(row % 2 ? COLORS.teal : COLORS.amber, 1).fillCircle(x + 18, y - 32 + row * 22, 3);
      }
    }

    drawTradingBank(x, y) {
      for (let index = 0; index < 3; index += 1) this.drawDesk(x + index * 66, y, index % 2 ? 0xd4524c : 0x4f70df);
    }

    drawCoffeePoint(x, y) {
      const g = this.add.graphics();
      g.fillStyle(0x24384b, 1).fillRoundedRect(x - 42, y - 28, 84, 56, 7);
      g.fillStyle(0xe6edf2, 1).fillRoundedRect(x - 28, y - 20, 34, 34, 5);
      g.fillStyle(0x101b27, 1).fillRoundedRect(x - 22, y - 15, 22, 13, 3);
      g.fillStyle(COLORS.teal, 1).fillCircle(x - 5, y - 9, 3);
      g.fillStyle(0xf3eadc, 1).fillRoundedRect(x + 15, y - 8, 14, 17, 3);
      this.add.text(x - 34, y + 34, 'COFFEE', {
        fontFamily: 'Manrope, sans-serif', fontSize: '9px', color: '#53677d', fontStyle: 'bold',
      });
    }

    drawCeilingLights() {
      [[255, 150], [625, 150], [965, 150], [280, 445], [720, 445], [1010, 445]].forEach(([x, y], index) => {
        const glow = this.add.ellipse(x, y, 170, 88, 0xffffff, 0.055).setDepth(2);
        this.tweens.add({
          targets: glow,
          alpha: { from: 0.035, to: 0.075 },
          duration: 1800 + index * 140,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      });
    }

    drawPlant(x, y) {
      const g = this.add.graphics();
      g.fillStyle(0xa66c42, 1).fillRoundedRect(x - 17, y, 34, 28, 6);
      g.fillStyle(0x2f966f, 1).fillEllipse(x - 10, y - 10, 23, 48).fillEllipse(x + 11, y - 13, 23, 52);
    }

    createAmbientLife() {
      const actorConfigs = [
        {
          color: 0x426b94,
          tool: 'folder',
          route: [[0.8, 3.2], [1.5, 1.6], [3.6, 2.8], [4.3, 1.2]],
          tasks: ['Collecting requests', 'Filing client records', 'Updating the operations queue', 'Delivering an approval pack'],
          speed: 0.62,
        },
        {
          color: 0xb07828,
          tool: 'tablet',
          route: [[5.4, 3.1], [5.8, 1.1], [7.6, 1.7], [8.4, 3.1]],
          tasks: ['Reviewing payment alerts', 'Checking case evidence', 'Recording an escalation', 'Clearing the control queue'],
          speed: 0.56,
        },
        {
          color: 0x27856f,
          tool: 'wrench',
          route: [[0.7, 9.1], [0.9, 6.8], [2.1, 8.0], [5.1, 8.8]],
          tasks: ['Checking server health', 'Tracing an access event', 'Updating the incident log', 'Testing a control fix'],
          speed: 0.59,
        },
        {
          color: 0x425f85,
          tool: 'tablet',
          route: [[6.7, 9.1], [7.4, 7.0], [9.5, 8.5], [13.0, 8.9]],
          tasks: ['Reviewing trade alerts', 'Monitoring the watch list', 'Reconciling an order', 'Checking desk activity'],
          speed: 0.68,
        },
        {
          color: 0x6d638f,
          tool: 'mug',
          route: [[9.6, 3.2], [10.2, 1.0], [12.0, 1.6], [13.1, 3.1]],
          tasks: ['Preparing meeting notes', 'Waiting for the client', 'Reviewing the agenda', 'Updating action items'],
          speed: 0.5,
        },
      ];

      this.ambientActors = actorConfigs.map((config, index) => {
        const [startX, startY] = config.route[0];
        const start = this.isoToScreen(startX, startY);
        const worker = this.makePerson(start.x, start.y, config.color, 0.72);
        worker.setDepth(Math.round(start.y + 80));
        const tool = this.createTaskProp(config.tool);
        const activityDot = this.add.text(0, -52, '•••', {
          fontFamily: 'Manrope, sans-serif', fontSize: '12px', color: '#314b63', fontStyle: 'bold',
          backgroundColor: '#ffffffdd', padding: { x: 5, y: 2 },
        }).setOrigin(0.5);
        const taskLabel = this.add.text(0, -76, config.tasks[0], {
          fontFamily: 'Manrope, sans-serif', fontSize: '10px', color: '#203650', fontStyle: 'bold',
          backgroundColor: '#fffffff2', padding: { x: 7, y: 4 },
        }).setOrigin(0.5).setAlpha(0);
        worker.add([tool, activityDot, taskLabel]);
        this.tweens.add({
          targets: activityDot,
          y: -56,
          alpha: { from: 0.55, to: 1 },
          duration: 650 + index * 70,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
        return {
          ...config,
          worker,
          tool,
          activityDot,
          taskLabel,
          routeIndex: 1,
          taskIndex: 0,
          worldX: startX,
          worldY: startY,
          waitUntil: this.time.now + 500 + index * 420,
          working: true,
        };
      });
    }

    createTaskProp(type) {
      const prop = this.add.graphics();
      if (type === 'folder') {
        prop.fillStyle(0xe3ad3e, 1).fillRoundedRect(-17, 5, 24, 16, 3);
        prop.fillStyle(0xf2c96f, 1).fillRoundedRect(-17, 2, 11, 6, 2);
      } else if (type === 'tablet') {
        prop.fillStyle(0x142638, 1).fillRoundedRect(-13, 2, 25, 20, 4);
        prop.fillStyle(0x6eb4d8, 1).fillRoundedRect(-9, 5, 17, 12, 2);
      } else if (type === 'wrench') {
        prop.lineStyle(4, 0x6c7d8e, 1).lineBetween(-10, 4, 8, 20);
        prop.strokeCircle(-12, 2, 5);
      } else {
        prop.fillStyle(0xf4f6f7, 1).fillRoundedRect(-9, 5, 14, 15, 3);
        prop.lineStyle(2, 0xc6d0d9, 1).strokeCircle(7, 12, 5);
        prop.fillStyle(0x9b633c, 1).fillRect(-6, 7, 8, 5);
      }
      return prop;
    }

    updateAmbientActors(delta) {
      if (!this.ambientActors.length) return;
      const now = this.time.now;
      const seconds = delta / 1000;
      this.ambientActors.forEach((actor, actorIndex) => {
        const playerDistance = this.player
          ? Phaser.Math.Distance.Between(this.playerWorld.x, this.playerWorld.y, actor.worldX, actor.worldY)
          : Infinity;
        actor.taskLabel.setAlpha(playerDistance < 1.8 && !this.overlay ? 1 : 0);

        if (now < actor.waitUntil) {
          actor.working = true;
          this.animatePerson(actor.worker, now / 280 + actorIndex, false);
          actor.tool.y = Math.sin(now / 180 + actorIndex) * 2;
          actor.tool.rotation = Math.sin(now / 230 + actorIndex) * 0.05;
          return;
        }

        actor.working = false;
        const [targetX, targetY] = actor.route[actor.routeIndex];
        const dx = targetX - actor.worldX;
        const dy = targetY - actor.worldY;
        const distance = Math.hypot(dx, dy);
        if (distance < 0.06) {
          actor.worldX = targetX;
          actor.worldY = targetY;
          const targetScreen = this.isoToScreen(targetX, targetY);
          actor.worker.setPosition(targetScreen.x, targetScreen.y);
          actor.routeIndex = (actor.routeIndex + 1) % actor.route.length;
          actor.taskIndex = (actor.taskIndex + 1) % actor.tasks.length;
          actor.taskLabel.setText(actor.tasks[actor.taskIndex]);
          actor.waitUntil = now + 1800 + ((actorIndex * 470 + actor.taskIndex * 310) % 1900);
          actor.working = true;
          actor.activityDot.setText('•••');
          return;
        }

        actor.activityDot.setText('→');
        const step = Math.min(distance, actor.speed * seconds);
        actor.worldX += (dx / distance) * step;
        actor.worldY += (dy / distance) * step;
        const screen = this.isoToScreen(actor.worldX, actor.worldY);
        actor.worker.setPosition(screen.x, screen.y);
        this.animatePerson(actor.worker, now / 115 + actorIndex, true);
        actor.tool.rotation = Math.sin(now / 110) * 0.08;
        actor.worker.setDepth(Math.round(screen.y + 80));
      });
    }

    createPlayer() {
      const start = this.isoToScreen(this.playerWorld.x, this.playerWorld.y);
      this.player = this.add.container(start.x, start.y).setDepth(Math.round(start.y + 80));
      const playerRing = this.add.circle(0, 8, 27, COLORS.blue, 0.12).setStrokeStyle(2, COLORS.blue, 0.55);
      this.playerShadow = this.add.ellipse(0, 28, 38, 13, 0x08131f, 0.22);
      this.playerBody = this.makePerson(0, 0, COLORS.blue, 1);
      const label = this.add.text(0, 48, 'YOU', {
        fontFamily: 'Manrope, sans-serif', fontSize: '11px', color: '#19324a', fontStyle: 'bold',
      }).setOrigin(0.5);
      this.player.add([playerRing, this.playerShadow, this.playerBody, label]);
    }

    makePerson(x, y, color, scale = 1) {
      const person = this.add.container(x, y).setScale(scale).setDepth(20);
      const shadow = this.add.ellipse(2, 30, 38, 12, 0x07111c, 0.2);

      const makeLeg = (side) => {
        const leg = this.add.container(side * 8, 12);
        const legShape = this.add.graphics();
        legShape.lineStyle(7, 0x1a2a3b, 1).lineBetween(0, 0, side, 17);
        legShape.fillStyle(0x0d1824, 1).fillEllipse(side, 19, 13, 7);
        leg.add(legShape);
        return leg;
      };

      const makeArm = (side) => {
        const arm = this.add.container(side * 15, -3);
        const armShape = this.add.graphics();
        armShape.lineStyle(7, color, 1).lineBetween(0, 0, side * 5, 17);
        armShape.fillStyle(0xe6b88e, 1).fillCircle(side * 5, 19, 4);
        arm.add(armShape);
        return arm;
      };

      const leftLeg = makeLeg(-1);
      const rightLeg = makeLeg(1);
      const leftArm = makeArm(-1);
      const rightArm = makeArm(1);
      const torso = this.add.container(0, 0);
      const body = this.add.graphics();
      body.fillStyle(color, 1).fillRoundedRect(-19, -11, 38, 31, 11);
      body.fillStyle(0xf4f7f9, 1).fillTriangle(-8, -9, 8, -9, 0, 8);
      body.fillStyle(0x253f58, 1).fillTriangle(-4, -7, 4, -7, 0, 8);
      body.fillStyle(0xe7b98f, 1).fillCircle(0, -22, 13);
      body.fillStyle(0x493629, 1).fillEllipse(0, -29, 25, 15);
      body.fillStyle(0x493629, 1).fillEllipse(-9, -24, 7, 15);
      body.fillStyle(0xd69e78, 0.65).fillEllipse(7, -18, 6, 4);
      body.fillStyle(0xf2d968, 1).fillRoundedRect(11, 0, 5, 8, 2);
      torso.add(body);

      person.add([shadow, leftLeg, rightLeg, leftArm, torso, rightArm]);
      person.walkParts = { shadow, leftLeg, rightLeg, leftArm, rightArm, torso };
      return person;
    }

    animatePerson(person, phase, walking) {
      const parts = person?.walkParts;
      if (!parts) return;
      const swing = walking ? Math.sin(phase) * 0.48 : 0;
      const legSwing = swing * 0.72;
      const bob = walking ? -Math.abs(Math.cos(phase)) * 2.2 : Math.sin(phase) * 0.35;
      const settle = walking ? 0.48 : 0.2;

      parts.leftArm.rotation += (swing - parts.leftArm.rotation) * settle;
      parts.rightArm.rotation += (-swing - parts.rightArm.rotation) * settle;
      parts.leftLeg.rotation += (-legSwing - parts.leftLeg.rotation) * settle;
      parts.rightLeg.rotation += (legSwing - parts.rightLeg.rotation) * settle;
      parts.torso.y += (bob - parts.torso.y) * settle;
      parts.torso.rotation += ((walking ? Math.sin(phase * 0.5) * 0.025 : 0) - parts.torso.rotation) * settle;
      const shadowScale = walking ? 1 - Math.abs(Math.cos(phase)) * 0.08 : 1;
      parts.shadow.scaleX += (shadowScale - parts.shadow.scaleX) * settle;
    }

    createMissionCharacters() {
      this.npcs = this.missions.map((mission, index) => {
        const spot = mission.world?.missionSpot
          || MISSION_SPOTS_BY_ID[mission.id]
          || MISSION_SPOTS[index % MISSION_SPOTS.length];
        const position = this.isoToScreen(spot.x, spot.y);
        const color = Phaser.Display.Color.HexStringToColor(mission.world.accent).color;
        const npc = this.makePerson(position.x, position.y, color, 0.82);
        const missionTool = this.createTaskProp({
          'data-privacy': 'tablet',
          aml: 'folder',
          'market-abuse': 'tablet',
          'third-party-risk': 'wrench',
        }[mission.topicId] || 'folder');
        npc.add(missionTool);
        npc.setDepth(Math.round(position.y + 80));
        const markerDepth = Math.round(position.y + 82);
        const ring = this.add.circle(position.x, position.y - 52, 18, color, 0.2).setDepth(markerDepth);
        const badge = this.add.text(position.x, position.y - 53, mission.completed ? '✓' : '!', {
          fontFamily: 'Manrope, sans-serif', fontSize: '21px', color: mission.completed ? '#15785d' : '#ffffff', fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(markerDepth + 1);
        const label = this.add.text(position.x, position.y + 43, mission.title, {
          fontFamily: 'Manrope, sans-serif', fontSize: '11px', color: '#203650', fontStyle: 'bold',
          backgroundColor: '#ffffffd9', padding: { x: 7, y: 4 },
        }).setOrigin(0.5).setDepth(markerDepth + 1);
        this.tweens.add({ targets: ring, scale: 1.35, alpha: 0.05, duration: 850 + index * 90, yoyo: true, repeat: -1 });
        this.tweens.add({ targets: npc, scaleX: 0.84, scaleY: 0.84, duration: 760 + index * 80, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tweens.add({
          targets: missionTool,
          y: -2,
          rotation: index % 2 ? 0.06 : -0.06,
          duration: 620 + index * 75,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
        return { mission, npc, ring, badge, label, worldX: spot.x, worldY: spot.y };
      });
    }

    createHud() {
      const g = this.add.graphics().setDepth(9000);
      g.fillStyle(0x3f73bb, 1).fillRect(0, 0, 1200, 94);
      g.fillStyle(0x3569ad, 0.5).fillPoints([{ x: 180, y: 0 }, { x: 350, y: 0 }, { x: 455, y: 94 }, { x: 285, y: 94 }], true);
      g.fillStyle(0x5b8ac8, 0.35).fillPoints([{ x: 760, y: 0 }, { x: 940, y: 0 }, { x: 1045, y: 94 }, { x: 865, y: 94 }], true);
      g.fillStyle(0x235892, 1).fillRect(0, 88, 1200, 6);

      g.fillStyle(0xffc93d, 1).fillCircle(42, 43, 29);
      g.lineStyle(4, 0xffffff, 0.8).strokeCircle(42, 43, 29);
      this.add.text(42, 42, '★', {
        fontFamily: 'Manrope, sans-serif', fontSize: '31px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(9001);
      this.add.text(82, 17, 'LEVEL 1', {
        fontFamily: 'Manrope, sans-serif', fontSize: '11px', color: '#dbeaff', fontStyle: 'bold',
      }).setDepth(9001);
      g.fillStyle(0x284e78, 1).fillRoundedRect(82, 39, 248, 26, 13);
      g.fillStyle(0x42c66f, 1).fillRoundedRect(85, 42, Math.max(20, 242 * (this.levelProgress / Math.max(1, this.missions.length))), 20, 10);
      this.progressText = this.add.text(206, 52, `${this.levelProgress}/${this.missions.length} MISSIONS`, {
        fontFamily: 'Manrope, sans-serif', fontSize: '12px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(9002);

      g.fillStyle(0xffffff, 0.92).fillRoundedRect(1018, 25, 154, 43, 22);
      g.fillStyle(0x38b96c, 1).fillRoundedRect(1027, 16, 38, 54, 8);
      this.add.text(1046, 43, '✓', {
        fontFamily: 'Manrope, sans-serif', fontSize: '24px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(9002);
      this.rewardText = this.add.text(1080, 31, `${this.levelProgress * 25}`, {
        fontFamily: 'Manrope, sans-serif', fontSize: '20px', color: '#24518d', fontStyle: 'bold',
      }).setDepth(9002);
      this.add.text(1080, 53, 'INTEGRITY', {
        fontFamily: 'Manrope, sans-serif', fontSize: '9px', color: '#64809f', fontStyle: 'bold',
      }).setDepth(9002);

      g.fillStyle(0xffffff, 0.95).fillRoundedRect(356, 108, 488, 82, 38);
      g.lineStyle(4, 0x3e71b8, 1).strokeRoundedRect(356, 108, 488, 82, 38);
      g.fillStyle(0x3e71b8, 1).fillCircle(404, 149, 28);
      this.add.text(404, 149, '!', {
        fontFamily: 'Manrope, sans-serif', fontSize: '29px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(9002);
      this.objectiveTitle = this.add.text(445, 126, 'Find a compliance mission', {
        fontFamily: 'Manrope, sans-serif', fontSize: '16px', color: '#27558f', fontStyle: 'bold',
      }).setDepth(9002);
      this.objectiveDetail = this.add.text(445, 151, 'Walk to a marked colleague', {
        fontFamily: 'Manrope, sans-serif', fontSize: '11px', color: '#6c8097', fontStyle: 'bold',
      }).setDepth(9002);
      g.fillStyle(0xd5dfe6, 1).fillRoundedRect(445, 169, 340, 10, 5);
      this.objectiveFill = this.add.graphics().setDepth(9003);
      this.updateObjectiveProgress();

      g.fillStyle(0xffffff, 0.95).fillRoundedRect(20, 112, 54, 54, 15);
      this.add.text(47, 139, '☰', {
        fontFamily: 'Manrope, sans-serif', fontSize: '30px', color: '#3671bb', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(9002);

      this.hudStatus = this.add.text(1180, 111, 'EXPLORE', {
        fontFamily: 'Manrope, sans-serif', fontSize: '11px', color: '#ffffff', fontStyle: 'bold',
        backgroundColor: '#2c5e99dd', padding: { x: 10, y: 6 },
      }).setOrigin(1, 0).setDepth(9002);
      this.audioButton = this.add.text(1180, 151, '♫ MUSIC', {
        fontFamily: 'Manrope, sans-serif', fontSize: '11px', color: '#ffffff', fontStyle: 'bold',
        backgroundColor: '#2c5e99dd', padding: { x: 10, y: 6 },
      }).setOrigin(1, 0).setInteractive({ useHandCursor: true }).setDepth(9002);
      this.audioButton.on('pointerup', () => this.toggleMusic());

      this.hint = this.add.text(600, 675, 'WASD / ARROWS TO MOVE  •  E / SPACE TO INTERACT', {
        fontFamily: 'Manrope, sans-serif', fontSize: '11px', color: '#ffffff', fontStyle: 'bold',
        backgroundColor: '#24558fd9', padding: { x: 15, y: 8 },
      }).setOrigin(0.5).setDepth(9005);
    }

    updateObjectiveProgress() {
      if (!this.objectiveFill) return;
      const ratio = this.levelProgress / Math.max(1, this.missions.length);
      this.objectiveFill.clear();
      this.objectiveFill.fillStyle(0x42c66f, 1).fillRoundedRect(445, 169, Math.max(8, 340 * ratio), 10, 5);
    }

    updateNearbyMission() {
      let closest = null;
      let closestDistance = Infinity;
      this.npcs.forEach((entry) => {
        const distance = Phaser.Math.Distance.Between(this.playerWorld.x, this.playerWorld.y, entry.worldX, entry.worldY);
        entry.label.setAlpha(distance < 1.8 ? 1 : 0);
        if (distance < closestDistance) {
          closest = entry.mission;
          closestDistance = distance;
        }
      });

      const nextMission = closestDistance < 1.15 ? closest : null;
      if (nextMission?.id === this.nearbyMission?.id) return;
      this.nearbyMission = nextMission;
      if (nextMission) {
        this.objectiveTitle.setText(nextMission.title);
        this.objectiveDetail.setText(`Press E or Space • ${nextMission.topicName}`);
        this.hint.setText('MISSION IN RANGE  •  PRESS E OR SPACE');
        this.hint.setBackgroundColor('#2e9e68e8');
      } else {
        this.objectiveTitle.setText('Find a compliance mission');
        this.objectiveDetail.setText('Walk to a marked colleague');
        this.hint.setText('WASD / ARROWS TO MOVE  •  E / SPACE TO INTERACT');
        this.hint.setBackgroundColor('#24558fd9');
      }
    }

    showMissionBrief(mission) {
      const overlay = this.beginOverlay();
      const color = Phaser.Display.Color.HexStringToColor(mission.world.accent).color;
      this.overlayPanel(overlay, 110, 105, 980, 510, 0xf8fafc, 0xcdd9e7);
      this.addOverlayText(overlay, 155, 145, `${mission.topicName.toUpperCase()} • ${mission.difficulty.toUpperCase()}`, 13, '#64768d', 800);
      this.addOverlayText(overlay, 155, 180, mission.title, 38, COLORS.ink, 900, 690);
      this.addOverlayText(overlay, 155, 245, mission.brief, 19, COLORS.muted, 500, 680);
      this.addOverlayText(overlay, 155, 340, 'MISSION OBJECTIVE', 12, '#64768d', 800);
      this.addOverlayText(overlay, 155, 370, mission.objective, 18, COLORS.ink, 700, 650);
      this.statPill(overlay, 820, 170, 'LOCATION', mission.world.room, color);
      this.statPill(overlay, 820, 260, 'DURATION', `${mission.estimatedMinutes} MIN`, COLORS.teal);
      this.statPill(overlay, 820, 350, 'STATUS', mission.completed ? `BEST ${mission.bestScore}%` : 'NEW MISSION', mission.completed ? COLORS.teal : COLORS.amber);
      this.overlayButton(overlay, 155, 510, 255, 58, mission.completed ? 'Replay mission' : 'Start mission', color, () => this.launchMission(mission));
      this.overlayButton(overlay, 430, 510, 180, 58, 'Return', 0x78899b, () => this.closeOverlay());
    }

    async launchMission(preview) {
      if (this.busy) return;
      this.busy = true;
      this.showBusyOverlay('Opening secure case file...');
      try {
        const bundle = await this.callbacks.onStartMission(preview.id);
        this.session = bundle.attempt;
        this.mission = bundle.mission;
        this.score = bundle.attempt.state.score;
        this.risk = bundle.attempt.state.risk;
        this.currentNode = this.mission.nodes.find((node) => node.id === this.mission.startNodeId);
        this.busy = false;
        this.closeOverlay();
        this.playCue('start');
        this.showNode(this.currentNode);
      } catch (error) {
        this.busy = false;
        this.closeOverlay();
        this.callbacks.onError(error.message || 'Unable to start the game mission.');
      }
    }

    showNode(node) {
      this.currentNode = node;
      const overlay = this.beginOverlay();
      this.overlayPanel(overlay, 70, 92, 1060, 555, 0xf8fafc, 0xcdd9e7);
      this.addOverlayText(overlay, 110, 125, 'LIVE MISSION', 12, '#657890', 800);
      this.addOverlayText(overlay, 110, 153, node.speaker, 25, COLORS.ink, 900, 640);
      this.addOverlayText(overlay, 110, 202, `“${node.message}”`, 20, '#31445d', 600, 640);

      if (node.artifact) {
        this.overlayPanel(overlay, 790, 125, 300, 205, 0xeaf0f6, 0xcdd9e7);
        this.addOverlayText(overlay, 815, 150, node.artifact.type.replace('-', ' ').toUpperCase(), 11, '#64768d', 800);
        this.addOverlayText(overlay, 815, 180, node.artifact.title, 18, COLORS.ink, 800, 250);
        this.addOverlayText(overlay, 815, 225, node.artifact.body, 14, COLORS.muted, 500, 250);
      }

      this.metric(overlay, 790, 352, 'CONTROL SCORE', this.score, COLORS.teal);
      this.metric(overlay, 945, 352, 'RISK LEVEL', this.risk, this.risk > 55 ? COLORS.red : COLORS.amber);
      this.addOverlayText(overlay, 110, 350, node.prompt, 21, COLORS.ink, 900, 630);
      node.choices.forEach((choice, index) => {
        this.choiceButton(overlay, 110, 400 + index * 69, 640, 56, choice, index);
      });
    }

    choiceButton(overlay, x, y, w, h, choice, index) {
      const fills = [0xffffff, 0xedf7f4, 0xfff7e8, 0xf3f0fb];
      const strokes = [0xcdd9e7, 0x9fd4c7, 0xe7c986, 0xc5bae8];
      this.overlayPanel(overlay, x, y, w, h, fills[index] || fills[0], strokes[index] || strokes[0]);
      this.addOverlayText(overlay, x + 18, y + 17, choice.label, 14, COLORS.ink, 700, w - 74);
      this.addOverlayText(overlay, x + w - 38, y + 14, '›', 25, '#4b6178', 800);
      const zone = this.add.zone(x, y, w, h).setOrigin(0).setInteractive({ useHandCursor: true });
      overlay.add(zone);
      zone.on('pointerover', () => zone.setScale(0.995));
      zone.on('pointerout', () => zone.setScale(1));
      zone.on('pointerup', () => this.submitChoice(choice));
    }

    async submitChoice(choice) {
      if (this.busy) return;
      this.busy = true;
      this.showBusyOverlay('Applying the control and calculating consequences...');
      try {
        const result = await this.callbacks.onDecision(this.session.id, this.currentNode.id, choice.id);
        this.score = result.score;
        this.risk = result.risk;
        this.busy = false;
        this.closeOverlay();
        this.playCue(choice.scoreDelta > 0 ? 'good' : 'bad');
        if (choice.scoreDelta <= 0) this.cameras.main.shake(260, 0.007);
        this.showConsequence(result, choice.scoreDelta);
      } catch (error) {
        this.busy = false;
        this.closeOverlay();
        this.callbacks.onError(error.message || 'Unable to save the mission decision.');
        this.showNode(this.currentNode);
      }
    }

    showConsequence(result, scoreDelta) {
      const positive = scoreDelta > 0;
      const accent = positive ? COLORS.teal : COLORS.red;
      this.burst(600, 220, accent, positive ? 28 : 18);
      const overlay = this.beginOverlay();
      this.overlayPanel(overlay, 195, 135, 810, 450, positive ? 0xf0faf6 : 0xfff3f1, positive ? 0x9fd4c7 : 0xefb4ae);
      this.addOverlayText(overlay, 240, 180, positive ? 'CONTROL HELD' : 'RISK INCREASED', 13, positive ? '#15785d' : '#a73f37', 900);
      this.addOverlayText(overlay, 240, 218, result.consequence, 25, COLORS.ink, 800, 720);
      this.metric(overlay, 240, 345, 'CONTROL SCORE', result.score, COLORS.teal);
      this.metric(overlay, 420, 345, 'RISK LEVEL', result.risk, result.risk > 55 ? COLORS.red : COLORS.amber);

      if (result.complete) {
        this.addOverlayText(overlay, 640, 350, result.report.performanceLabel.toUpperCase(), 16, positive ? '#15785d' : '#a73f37', 900);
        this.overlayButton(overlay, 240, 475, 270, 58, 'View mission result', accent, () => this.showMissionComplete(result.report));
      } else {
        this.overlayButton(overlay, 240, 475, 270, 58, 'Continue mission', accent, () => {
          this.closeOverlay();
          this.showNode(result.nextNode);
        });
      }
    }

    showMissionComplete(report) {
      this.closeOverlay();
      const overlay = this.beginOverlay();
      this.overlayPanel(overlay, 180, 110, 840, 500, 0xf8fafc, 0xcdd9e7);
      this.addOverlayText(overlay, 230, 155, 'MISSION COMPLETE', 13, '#64768d', 900);
      this.addOverlayText(overlay, 230, 195, report.title, 34, COLORS.ink, 900, 680);
      this.addOverlayText(overlay, 230, 260, `${report.score}%`, 64, report.score >= 70 ? '#15785d' : '#b46d18', 900);
      this.addOverlayText(overlay, 405, 278, report.performanceLabel, 22, COLORS.ink, 800);
      this.addOverlayText(overlay, 230, 350, report.keyTakeaway, 17, COLORS.muted, 600, 650);
      this.statPill(overlay, 705, 250, 'REWARD', `+${report.xpAwarded} XP`, COLORS.violet);
      this.overlayButton(overlay, 230, 500, 310, 58, 'Return to office floor', COLORS.teal, () => this.returnToHub(report));
      this.playCue('complete');
    }

    returnToHub(report) {
      const preview = this.missions.find((item) => item.id === report.activityId);
      const wasCompleted = Boolean(preview?.completed);
      if (preview) {
        preview.completed = true;
        preview.bestScore = Math.max(preview.bestScore || 0, report.score);
      }
      if (!wasCompleted) this.levelProgress = Math.min(this.missions.length, this.levelProgress + 1);
      this.progressText?.setText(`${this.levelProgress}/${this.missions.length} MISSIONS`);
      this.rewardText?.setText(`${this.levelProgress * 25}`);
      this.updateObjectiveProgress();
      this.callbacks.onComplete(report);
      this.session = null;
      this.mission = null;
      this.currentNode = null;
      this.closeOverlay();
      this.hudStatus.setText('MISSION SAVED');
      this.objectiveTitle.setText('Mission complete');
      this.objectiveDetail.setText(`${report.score}% • +${report.xpAwarded} XP`);
      this.hint.setText('MISSION SAVED  •  FIND THE NEXT CHALLENGE');
      this.time.delayedCall(2400, () => this.hudStatus.setText('EXPLORE THE FLOOR'));
    }

    beginOverlay() {
      this.closeOverlay();
      this.overlay = this.add.container(0, 0).setDepth(10000);
      const scrim = this.add.rectangle(0, 0, 1200, 720, 0x06111e, 0.78).setOrigin(0);
      this.overlay.add(scrim);
      return this.overlay;
    }

    closeOverlay() {
      if (this.overlay) this.overlay.destroy(true);
      this.overlay = null;
    }

    showBusyOverlay(label) {
      const overlay = this.beginOverlay();
      this.overlayPanel(overlay, 380, 285, 440, 150, 0xf8fafc, 0xcdd9e7);
      const spinner = this.add.circle(438, 360, 18, COLORS.blue, 0.15).setStrokeStyle(4, COLORS.blue, 1);
      overlay.add(spinner);
      this.tweens.add({ targets: spinner, angle: 360, duration: 780, repeat: -1 });
      this.addOverlayText(overlay, 480, 342, label, 17, COLORS.ink, 800, 290);
    }

    overlayPanel(container, x, y, w, h, fill, stroke) {
      const g = this.add.graphics();
      g.fillStyle(fill, 1).fillRoundedRect(x, y, w, h, 14);
      g.lineStyle(1, stroke, 1).strokeRoundedRect(x, y, w, h, 14);
      container.add(g);
      return g;
    }

    addOverlayText(container, x, y, value, size, color, weight = 500, width = 360) {
      const item = this.add.text(x, y, value, {
        fontFamily: 'Manrope, sans-serif',
        fontSize: `${size}px`,
        color,
        fontStyle: weight >= 700 ? 'bold' : 'normal',
        lineSpacing: 6,
        wordWrap: { width, useAdvancedWrap: true },
      });
      container.add(item);
      return item;
    }

    overlayButton(container, x, y, w, h, label, fill, action) {
      const g = this.add.graphics();
      g.fillStyle(fill, 1).fillRoundedRect(x, y, w, h, 10);
      const text = this.add.text(x + w / 2, y + h / 2, label, {
        fontFamily: 'Manrope, sans-serif', fontSize: '15px', color: COLORS.white, fontStyle: 'bold',
      }).setOrigin(0.5);
      const zone = this.add.zone(x, y, w, h).setOrigin(0).setInteractive({ useHandCursor: true });
      container.add([g, text, zone]);
      zone.on('pointerover', () => { g.setAlpha(0.86); text.setScale(1.02); });
      zone.on('pointerout', () => { g.setAlpha(1); text.setScale(1); });
      zone.on('pointerup', action);
    }

    statPill(container, x, y, label, value, accent) {
      this.overlayPanel(container, x, y, 230, 72, 0xffffff, 0xd6e0eb);
      const bar = this.add.rectangle(x, y, 6, 72, accent, 1).setOrigin(0);
      container.add(bar);
      this.addOverlayText(container, x + 20, y + 13, label, 10, '#708197', 800);
      this.addOverlayText(container, x + 20, y + 35, value, 14, COLORS.ink, 800, 190);
    }

    metric(container, x, y, label, value, accent) {
      this.addOverlayText(container, x, y, label, 10, '#708197', 800);
      const color = `#${accent.toString(16).padStart(6, '0')}`;
      this.addOverlayText(container, x, y + 20, `${value}%`, 28, color, 900);
    }

    burst(x, y, color, count) {
      for (let index = 0; index < count; index += 1) {
        const dot = this.add.circle(x, y, Phaser.Math.Between(3, 7), color, 0.9).setDepth(10020);
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const distance = Phaser.Math.Between(55, 190);
        this.tweens.add({
          targets: dot,
          x: x + Math.cos(angle) * distance,
          y: y + Math.sin(angle) * distance,
          alpha: 0,
          scale: 0.2,
          duration: Phaser.Math.Between(500, 950),
          ease: 'Cubic.easeOut',
          onComplete: () => dot.destroy(),
        });
      }
    }

    setupMusic() {
      this.music = this.sound.add('sakura-daisy', { loop: true, volume: 0.14 });
      this.input.once('pointerdown', () => this.ensureMusicPlaying());
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.music?.stop();
        this.music?.destroy();
      });
    }

    ensureMusicPlaying() {
      if (!this.musicOn || !this.music || this.music.isPlaying) return;
      try {
        if (this.music.isPaused) this.music.resume();
        else this.music.play();
      } catch {
        // Browsers can defer media until the next explicit interaction.
      }
    }

    toggleMusic() {
      this.musicOn = !this.musicOn;
      if (this.musicOn) this.ensureMusicPlaying();
      else this.music?.pause();
      this.audioButton?.setText(this.musicOn ? '♫ MUSIC' : '♫ MUTED');
    }

    playCue(kind) {
      if (!this.soundOn) return;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.audioContext ??= new AudioContext();
      if (this.audioContext.state === 'suspended') this.audioContext.resume();
      const cues = {
        start: [[330, 0], [440, 0.08], [560, 0.16]],
        good: [[520, 0], [660, 0.055], [790, 0.11]],
        bad: [[220, 0], [170, 0.09]],
        complete: [[440, 0], [560, 0.07], [690, 0.14], [880, 0.22]],
        tick: [[460, 0]],
      };
      const notes = cues[kind] || cues.tick;
      notes.forEach(([frequency, delay], index) => {
        const start = this.audioContext.currentTime + delay;
        const duration = kind === 'bad' ? 0.16 : 0.11 + index * 0.01;
        const oscillator = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        oscillator.type = kind === 'bad' ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(0.09, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        oscillator.connect(gain);
        gain.connect(this.audioContext.destination);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.02);
      });
    }

  };
}
