(() => {
  "use strict";

  const canvas = document.querySelector("#game");
  const context = canvas.getContext("2d");
  const jumpButton = document.querySelector("#jump-button");

  const WIDTH = 540;
  const HEIGHT = 960;
  const OWNER_FLOOR_Y = 710;
  const FLOOR_Y = 748;
  const START_X = 164;
  const CAT_WIDTH = 90;
  const CAT_HEIGHT = 76;
  const GRAVITY = 2150;
  const JUMP_VELOCITY = -790;
  const STORAGE_KEY = "smokey-runner-best";

  const COLORS = {
    ink: "#241a19",
    wall: "#dfc49f",
    wallShade: "#b89168",
    floor: "#9b5f35",
    floorDark: "#593524",
    mint: "#7fb082",
    yellow: "#e8b75b",
    red: "#bd5548",
    blue: "#637d91",
    white: "#fff1d7",
  };

  const art = {
    background: loadImage("/assets/smokey-run-background.png"),
    catRun: loadSpriteSheet("/assets/smokey-run-sheet.png", 5, 5),
    catJump: loadSpriteSheet("/assets/smokey-jump-sheet.png", 5, 5),
    ownerRun: loadSpriteSheet("/assets/man-run-sheet.png", 5, 5),
    chicken: loadKeyedImage("/assets/chicken-drumstick.jpg"),
    tuna: loadKeyedImage("/assets/can-of-tuna.jpg"),
  };

  const state = {
    mode: "title",
    time: 0,
    best: Number(localStorage.getItem(STORAGE_KEY) || 0),
    speed: 285,
    distance: 72,
    nextSpawn: 1.15,
    shake: 0,
    flash: 0,
    message: "",
    messageTimer: 0,
    sceneTime: 0,
    backgroundOffset: 0,
    objects: [],
    particles: [],
    lastTime: performance.now(),
    player: {
      x: START_X,
      y: FLOOR_Y - CAT_HEIGHT,
      width: CAT_WIDTH,
      height: CAT_HEIGHT,
      velocityY: 0,
      grounded: true,
      invulnerable: 0,
      boost: 0,
    },
  };

  function loadImage(source) {
    const image = new Image();
    image.src = source;
    return image;
  }

  function loadAnimationFrame(source) {
    const frame = { image: loadImage(source), cutout: null };
    frame.image.addEventListener("load", () => {
      frame.cutout = createCheckerboardCutout(frame.image);
    });
    return frame;
  }

  function loadKeyedImage(source) {
    const asset = { image: loadImage(source), cutout: null };
    asset.image.addEventListener("load", () => {
      const canvas = document.createElement("canvas");
      canvas.width = asset.image.naturalWidth;
      canvas.height = asset.image.naturalHeight;
      const keyedContext = canvas.getContext("2d", { willReadFrequently: true });
      keyedContext.drawImage(asset.image, 0, 0);
      const pixels = keyedContext.getImageData(0, 0, canvas.width, canvas.height);
      const key = [pixels.data[0], pixels.data[1], pixels.data[2]];

      for (let index = 0; index < pixels.data.length; index += 4) {
        const redDifference = pixels.data[index] - key[0];
        const greenDifference = pixels.data[index + 1] - key[1];
        const blueDifference = pixels.data[index + 2] - key[2];
        const distance = Math.sqrt(
          redDifference * redDifference +
          greenDifference * greenDifference +
          blueDifference * blueDifference,
        );
        if (distance < 34) pixels.data[index + 3] = 0;
      }

      keyedContext.putImageData(pixels, 0, 0);
      asset.cutout = trimmedFrame(canvas);
    });
    return asset;
  }

  function loadSpriteSheet(source, columns, rows) {
    const sheet = {
      image: loadImage(source),
      frames: Array.from({ length: columns * rows }, () => ({ cutout: null })),
    };
    sheet.image.addEventListener("load", () => {
      const cellWidth = sheet.image.naturalWidth / columns;
      const cellHeight = sheet.image.naturalHeight / rows;
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const index = row * columns + column;
          sheet.frames[index].cutout = createSheetCellCutout(
            sheet.image,
            column * cellWidth,
            row * cellHeight,
            cellWidth,
            cellHeight,
          );
        }
      }
    });
    return sheet.frames;
  }

  function createSheetCellCutout(image, sourceX, sourceY, width, height) {
    const cell = document.createElement("canvas");
    cell.width = width;
    cell.height = height;
    const cellContext = cell.getContext("2d", { willReadFrequently: true });
    cellContext.drawImage(image, sourceX, sourceY, width, height, 0, 0, width, height);
    const pixels = cellContext.getImageData(0, 0, width, height);
    const key = [pixels.data[0], pixels.data[1], pixels.data[2]];
    const hasVisibleColorKey = pixels.data[3] > 128;

    for (let index = 0; index < pixels.data.length; index += 4) {
      const redDifference = pixels.data[index] - key[0];
      const greenDifference = pixels.data[index + 1] - key[1];
      const blueDifference = pixels.data[index + 2] - key[2];
      const keyDistance = Math.sqrt(
        redDifference * redDifference +
        greenDifference * greenDifference +
        blueDifference * blueDifference,
      );
      if (pixels.data[index + 3] < 24 || (hasVisibleColorKey && keyDistance < 36)) {
        pixels.data[index + 3] = 0;
      }
    }

    cellContext.putImageData(pixels, 0, 0);
    return trimmedFrame(cell);
  }

  function createCheckerboardCutout(image) {
    const cutout = document.createElement("canvas");
    cutout.width = image.naturalWidth;
    cutout.height = image.naturalHeight;
    const cutoutContext = cutout.getContext("2d", { willReadFrequently: true });
    cutoutContext.drawImage(image, 0, 0);

    const width = cutout.width;
    const height = cutout.height;
    const pixels = cutoutContext.getImageData(0, 0, width, height);
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let queueStart = 0;
    let queueEnd = 0;

    function isBackdrop(pixelIndex) {
      const dataIndex = pixelIndex * 4;
      const red = pixels.data[dataIndex];
      const green = pixels.data[dataIndex + 1];
      const blue = pixels.data[dataIndex + 2];
      return Math.min(red, green, blue) > 225 && Math.max(red, green, blue) - Math.min(red, green, blue) < 14;
    }

    function enqueue(pixelIndex) {
      if (visited[pixelIndex] || !isBackdrop(pixelIndex)) return;
      visited[pixelIndex] = 1;
      queue[queueEnd] = pixelIndex;
      queueEnd += 1;
    }

    for (let x = 0; x < width; x += 1) {
      enqueue(x);
      enqueue((height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y += 1) {
      enqueue(y * width);
      enqueue(y * width + width - 1);
    }

    while (queueStart < queueEnd) {
      const pixelIndex = queue[queueStart];
      queueStart += 1;
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      pixels.data[pixelIndex * 4 + 3] = 0;
      if (x > 0) enqueue(pixelIndex - 1);
      if (x < width - 1) enqueue(pixelIndex + 1);
      if (y > 0) enqueue(pixelIndex - width);
      if (y < height - 1) enqueue(pixelIndex + width);
    }

    cutoutContext.putImageData(pixels, 0, 0);

    return trimmedFrame(cutout);
  }

  function trimmedFrame(frameCanvas) {
    const frameContext = frameCanvas.getContext("2d", { willReadFrequently: true });
    const width = frameCanvas.width;
    const height = frameCanvas.height;
    const pixels = frameContext.getImageData(0, 0, width, height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixels.data[(y * width + x) * 4 + 3] === 0) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (maxX < minX || maxY < minY) return null;
    return {
      canvas: frameCanvas,
      bounds: {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      },
    };
  }

  function animationSample(sequence, framesPerSecond, frameOrder) {
    const progress = state.sceneTime * framesPerSecond;
    const step = Math.floor(progress);
    const blend = progress - step;
    const order = frameOrder || sequence.map((_, index) => index);
    const currentIndex = order[step % order.length];
    const nextIndex = order[(step + 1) % order.length];
    return {
      current: sequence[currentIndex].cutout,
      next: sequence[nextIndex].cutout,
      blend: blend * blend * (3 - 2 * blend),
    };
  }

  function animationFrameByProgress(sequence, progress) {
    const clampedProgress = Math.max(0, Math.min(0.999, progress));
    return sequence[Math.floor(clampedProgress * sequence.length)].cutout;
  }

  function animationFrame(sequence, framesPerSecond) {
    const frameIndex = Math.floor(state.sceneTime * framesPerSecond) % sequence.length;
    return sequence[frameIndex].cutout;
  }

  function drawAnchoredFrame(frame, anchorX, groundY, targetWidth, referenceWidth, anchorRatio, opacity = 1) {
    if (!frame) return false;
    const { canvas: frameCanvas, bounds } = frame;
    const scale = targetWidth / referenceWidth;
    const drawWidth = bounds.width * scale;
    const drawHeight = bounds.height * scale;
    context.save();
    context.globalAlpha *= opacity;
    context.drawImage(
      frameCanvas,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      anchorX - drawWidth * anchorRatio,
      groundY - drawHeight,
      drawWidth,
      drawHeight,
    );
    context.restore();
    return true;
  }

  function drawAnimationSample(sample, anchorX, groundY, targetWidth, referenceWidth, anchorRatio) {
    if (!sample.current && !sample.next) return false;
    drawAnchoredFrame(
      sample.current || sample.next,
      anchorX,
      groundY,
      targetWidth,
      referenceWidth,
      anchorRatio,
      sample.current && sample.next ? 1 - sample.blend : 1,
    );
    if (sample.current && sample.next && sample.current !== sample.next) {
      drawAnchoredFrame(
        sample.next,
        anchorX,
        groundY,
        targetWidth,
        referenceWidth,
        anchorRatio,
        sample.blend,
      );
    }
    return true;
  }

  function resetGame() {
    state.mode = "playing";
    state.time = 0;
    state.speed = 285;
    state.distance = 72;
    state.nextSpawn = 1.3;
    state.shake = 0;
    state.flash = 0;
    state.message = "RUN, SMOKEY!";
    state.messageTimer = 1.2;
    state.objects.length = 0;
    state.particles.length = 0;
    Object.assign(state.player, {
      x: START_X,
      y: FLOOR_Y - CAT_HEIGHT,
      width: CAT_WIDTH,
      height: CAT_HEIGHT,
      velocityY: 0,
      grounded: true,
      invulnerable: 0,
      boost: 0,
    });
  }

  function startOrJump() {
    if (state.mode === "title" || state.mode === "gameover") {
      resetGame();
      return;
    }

    const player = state.player;
    if (player.grounded) {
      player.velocityY = JUMP_VELOCITY;
      player.grounded = false;
      burst(player.x + 35, FLOOR_Y - 8, COLORS.white, 7);
    }
  }

  function bindHoldButton(button, onPress, onRelease) {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      onPress();
    });
    button.addEventListener("pointerup", (event) => {
      event.preventDefault();
      onRelease?.();
    });
    button.addEventListener("pointercancel", () => onRelease?.());
    button.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  bindHoldButton(jumpButton, startOrJump);

  window.addEventListener("keydown", (event) => {
    if (["Space", "ArrowUp"].includes(event.code)) event.preventDefault();
    if ((event.code === "Space" || event.code === "ArrowUp") && !event.repeat) startOrJump();
    if (event.code === "Enter" && state.mode !== "playing") resetGame();
  });

  function spawnObject() {
    const difficulty = Math.min(1, state.time / 75);
    const roll = Math.random();
    let type;

    if (roll < 0.72) type = "low";
    else type = "food";

    if (type === "low") {
      state.objects.push({
        type,
        x: WIDTH + 40,
        y: FLOOR_Y - 48,
        width: 54,
        height: 48,
        label: Math.random() > 0.5 ? "BOX" : "SHOE",
        hit: false,
      });
    } else {
      const label = Math.random() > 0.5 ? "TUNA" : "CHICKEN";
      const width = label === "TUNA" ? 48 : 43;
      const height = label === "TUNA" ? 34 : 48;
      state.objects.push({
        type,
        x: WIDTH + 40,
        y: FLOOR_Y - (Math.random() > 0.5 ? 128 : 74),
        width,
        height,
        label,
        hit: false,
        bob: Math.random() * Math.PI * 2,
      });
    }

    const baseGap = 1.22 - difficulty * 0.25;
    state.nextSpawn = baseGap + Math.random() * 0.62;
  }

  function playerBounds() {
    const player = state.player;
    return {
      x: player.x + 18,
      y: player.y + 10,
      width: player.width - 34,
      height: CAT_HEIGHT - 18,
    };
  }

  function objectBounds(object) {
    if (object.type === "food") return object;

    const horizontalInset = 6;
    const verticalInset = 4;
    return {
      x: object.x + horizontalInset,
      y: object.y + verticalInset,
      width: object.width - horizontalInset * 2,
      height: object.height - verticalInset * 2,
    };
  }

  function overlaps(a, b) {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }

  function hitObstacle(object) {
    const player = state.player;
    object.hit = true;
    player.invulnerable = 1.15;
    player.velocityY = Math.min(player.velocityY, -180);
    state.distance -= 22;
    state.shake = 0.35;
    state.flash = 0.16;
    state.message = "BONK! OWNER CLOSING IN";
    state.messageTimer = 1;
    burst(player.x + player.width, FLOOR_Y - 44, COLORS.red, 13);
  }

  function collectFood(object) {
    object.hit = true;
    state.player.boost = 2.1;
    state.distance = Math.min(100, state.distance + 16);
    state.message = `${object.label} BOOST!`;
    state.messageTimer = 1;
    burst(object.x + object.width / 2, object.y + object.height / 2, COLORS.yellow, 16);
  }

  function burst(x, y, color, count) {
    for (let i = 0; i < count; i += 1) {
      state.particles.push({
        x,
        y,
        velocityX: (Math.random() - 0.5) * 280,
        velocityY: -80 - Math.random() * 260,
        life: 0.45 + Math.random() * 0.45,
        size: 4 + Math.random() * 8,
        color,
      });
    }
  }

  function endGame() {
    state.mode = "gameover";
    state.best = Math.max(state.best, state.time);
    localStorage.setItem(STORAGE_KEY, state.best.toFixed(2));
  }

  function update(delta) {
    state.sceneTime += delta;
    const backgroundSpeed = state.mode === "playing" ? state.speed * 0.2 : 28;
    const backgroundWidth = art.background.naturalWidth
      ? HEIGHT * (art.background.naturalWidth / art.background.naturalHeight)
      : WIDTH * 2;
    state.backgroundOffset = (state.backgroundOffset + backgroundSpeed * delta) % (backgroundWidth * 2);

    if (state.mode !== "playing") {
      updateParticles(delta);
      return;
    }

    state.time += delta;
    state.speed = 285 + Math.min(185, state.time * 2.25);
    state.nextSpawn -= delta;
    state.shake = Math.max(0, state.shake - delta);
    state.flash = Math.max(0, state.flash - delta);
    state.messageTimer = Math.max(0, state.messageTimer - delta);

    const player = state.player;
    player.invulnerable = Math.max(0, player.invulnerable - delta);
    player.boost = Math.max(0, player.boost - delta);

    const pressure = 1.45 + Math.min(1.35, state.time / 70);
    state.distance -= pressure * delta;
    if (player.boost > 0) state.distance = Math.min(100, state.distance + 5.5 * delta);

    if (!player.grounded) {
      player.velocityY += GRAVITY * delta;
      player.y += player.velocityY * delta;
      if (player.y >= FLOOR_Y - CAT_HEIGHT) {
        player.y = FLOOR_Y - CAT_HEIGHT;
        player.velocityY = 0;
        player.grounded = true;
        burst(player.x + 40, FLOOR_Y - 6, COLORS.wallShade, 5);
      }
    }

    if (state.nextSpawn <= 0) spawnObject();

    const movement = state.speed * (player.boost > 0 ? 1.16 : 1);
    const bounds = playerBounds();
    for (const object of state.objects) {
      object.x -= movement * delta;
      if (object.bob !== undefined) object.bob += delta * 5;

      if (!object.hit && overlaps(bounds, objectBounds(object))) {
        if (object.type === "food") collectFood(object);
        else if (player.invulnerable <= 0) hitObstacle(object);
      }
    }
    state.objects = state.objects.filter((object) => object.x + object.width > -30 && !object.hit);

    updateParticles(delta);
    if (state.distance <= 0) endGame();
  }

  function updateParticles(delta) {
    for (const particle of state.particles) {
      particle.life -= delta;
      particle.velocityY += 720 * delta;
      particle.x += particle.velocityX * delta;
      particle.y += particle.velocityY * delta;
    }
    state.particles = state.particles.filter((particle) => particle.life > 0);
  }

  function roundedRect(x, y, width, height, radius, fill, stroke = null, lineWidth = 0) {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    context.fillStyle = fill;
    context.fill();
    if (stroke) {
      context.lineWidth = lineWidth;
      context.strokeStyle = stroke;
      context.stroke();
    }
  }

  function drawBackground() {
    if (art.background.complete && art.background.naturalWidth) {
      const renderedWidth = HEIGHT * (art.background.naturalWidth / art.background.naturalHeight);
      const startPanel = Math.floor(state.backgroundOffset / renderedWidth);
      const panelOffset = state.backgroundOffset % renderedWidth;

      for (let index = -1; index <= 1; index += 1) {
        const panel = startPanel + index;
        const x = index * renderedWidth - panelOffset;
        const mirrored = ((panel % 2) + 2) % 2 === 1;

        context.save();
        if (mirrored) {
          context.translate(x + renderedWidth, 0);
          context.scale(-1, 1);
          context.drawImage(art.background, 0, 0, renderedWidth, HEIGHT);
        } else {
          context.drawImage(art.background, x, 0, renderedWidth, HEIGHT);
        }
        context.restore();
      }

      context.fillStyle = "rgb(24 13 10 / 6%)";
      context.fillRect(0, 0, WIDTH, HEIGHT);
    } else {
      context.fillStyle = COLORS.wall;
      context.fillRect(0, 0, WIDTH, FLOOR_Y);
      context.fillStyle = COLORS.floor;
      context.fillRect(0, FLOOR_Y, WIDTH, HEIGHT - FLOOR_Y);
    }

    context.fillStyle = "rgb(36 26 25 / 48%)";
    context.fillRect(0, FLOOR_Y - 5, WIDTH, 10);
  }

  function drawOwner() {
    const urgency = 1 - Math.max(0, state.distance) / 100;
    const x = -174 + urgency * 132;
    const y = OWNER_FLOOR_Y - 236;
    const ownerFrame = animationFrame(art.ownerRun, state.mode === "playing" ? 18 : 9);

    if (!drawAnchoredFrame(ownerFrame, x + 132, y + 261, 225, 205, 0.62)) {
      context.save();
      context.translate(x + 55, y + 55);
      roundedRect(0, 0, 100, 110, 5, "#b89168", COLORS.ink, 6);
      context.restore();
    }
  }

  function drawCat() {
    const player = state.player;
    const drawY = player.y;
    const height = CAT_HEIGHT;
    const blink = player.invulnerable > 0 && Math.floor(player.invulnerable * 12) % 2 === 0;
    if (blink) return;

    context.save();
    if (player.boost > 0) {
      context.fillStyle = "rgb(255 213 110 / 32%)";
      context.beginPath();
      context.ellipse(player.x + 46, drawY + height / 2, 68, height / 1.25, 0, 0, Math.PI * 2);
      context.fill();
    }

    const speedRatio = state.mode === "playing" ? state.speed / 285 : 0.75;
    const frameWidth = 172;
    const sourceWidth = 205;
    const frameGroundY = drawY + CAT_HEIGHT;
    const catAnchorX = player.x + 76;
    const airborne = !player.grounded;
    const jumpProgress = airborne
      ? Math.max(0, Math.min(1, (player.velocityY - JUMP_VELOCITY) / (Math.abs(JUMP_VELOCITY) * 2)))
      : 0;
    const drewCat = airborne
      ? drawAnchoredFrame(
          animationFrameByProgress(art.catJump, jumpProgress),
          catAnchorX,
          frameGroundY,
          frameWidth,
          sourceWidth,
          0.53,
        )
      : drawAnimationSample(
          {
            current: animationFrame(art.catRun, 18 * speedRatio),
            next: null,
            blend: 0,
          },
          catAnchorX,
          frameGroundY,
          frameWidth,
          sourceWidth,
          0.54,
        );

    if (!drewCat) {
      roundedRect(player.x + 8, drawY + 8, 82, height - 10, 18, "#6f665a", COLORS.ink, 6);
    }
    context.restore();
  }

  function drawObject(object) {
    const bobY = object.bob === undefined ? 0 : Math.sin(object.bob) * 6;
    const x = object.x;
    const y = object.y + bobY;

    if (object.type === "low") {
      if (object.label === "SHOE") {
        pixelShoe(x, y);
      } else {
        pixelBox(x, y);
      }
    } else {
      pixelFood(x, y, object.label);
    }
  }

  function pixelBox(x, y) {
    context.fillStyle = COLORS.ink;
    context.fillRect(x, y + 4, 54, 44);
    context.fillStyle = "#a9683c";
    context.fillRect(x + 5, y + 9, 44, 34);
    context.fillStyle = "#d39755";
    context.fillRect(x + 9, y + 12, 14, 4);
    context.fillRect(x + 25, y + 9, 5, 34);
    context.fillStyle = "#77432d";
    context.fillRect(x + 7, y + 35, 40, 6);
  }

  function pixelShoe(x, y) {
    context.fillStyle = COLORS.ink;
    context.fillRect(x + 2, y + 14, 49, 32);
    context.fillRect(x + 27, y + 6, 21, 16);
    context.fillStyle = "#b95b4e";
    context.fillRect(x + 7, y + 18, 38, 20);
    context.fillStyle = COLORS.white;
    context.fillRect(x + 7, y + 38, 44, 6);
    context.fillStyle = "#e6ae79";
    context.fillRect(x + 29, y + 11, 14, 5);
  }

  function pixelFood(x, y, label) {
    const asset = label === "TUNA" ? art.tuna.cutout : art.chicken.cutout;
    if (asset) {
      context.drawImage(
        asset.canvas,
        asset.bounds.x,
        asset.bounds.y,
        asset.bounds.width,
        asset.bounds.height,
        x,
        y,
        label === "TUNA" ? 48 : 43,
        label === "TUNA" ? 34 : 48,
      );
    } else {
      context.fillStyle = COLORS.yellow;
      context.fillRect(x, y, 38, 32);
    }
  }

  function drawHud() {
    context.shadowColor = COLORS.ink;
    context.shadowOffsetX = 2;
    context.shadowOffsetY = 2;
    context.shadowBlur = 0;
    context.textAlign = "left";
    context.fillStyle = COLORS.white;
    context.font = "700 17px Courier New";
    context.fillText("ESCAPE TIME", 24, 38);
    context.font = "700 36px Courier New";
    context.fillText(formatTime(state.time), 24, 76);

    context.textAlign = "right";
    context.font = "700 14px Courier New";
    context.fillText(`BEST ${formatTime(state.best)}`, WIDTH - 24, 42);

    context.shadowColor = "transparent";
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
    roundedRect(24, 96, WIDTH - 48, 30, 15, "#aab0b5", COLORS.ink, 4);
    const meterWidth = Math.max(0, (WIDTH - 58) * Math.max(0, state.distance) / 100);
    roundedRect(29, 101, meterWidth, 20, 10, state.distance < 30 ? COLORS.red : COLORS.mint);
    context.textAlign = "center";
    context.fillStyle = COLORS.ink;
    context.font = "700 13px Courier New";
    context.fillText("DISTANCE FROM CARRIER", WIDTH / 2, 119);

    if (state.messageTimer > 0) {
      roundedRect(80, 156, WIDTH - 160, 42, 12, COLORS.ink);
      context.fillStyle = COLORS.white;
      context.font = "700 16px Courier New";
      context.fillText(state.message, WIDTH / 2, 183);
    }
  }

  function drawOverlay() {
    if (state.mode === "playing") return;
    context.fillStyle = "rgb(15 22 39 / 74%)";
    context.fillRect(0, 0, WIDTH, HEIGHT);

    context.textAlign = "center";
    context.fillStyle = COLORS.white;
    context.font = "700 54px Courier New";
    context.fillText("SMOKEY", WIDTH / 2, 264);
    context.fillStyle = COLORS.yellow;
    context.fillText("RUN!", WIDTH / 2, 324);

    if (state.mode === "title") {
      context.fillStyle = COLORS.white;
      context.font = "700 19px Courier New";
      context.fillText("YOUR OWNER WANTS TO TAKE", WIDTH / 2, 364);
      context.fillText("YOU TO THE VET!", WIDTH / 2, 390);
      roundedRect(70, 418, WIDTH - 140, 132, 18, "#eef1ef", COLORS.ink, 6);
      context.fillStyle = COLORS.ink;
      context.font = "700 16px Courier New";
      context.fillText("JUMP OVER HOUSEHOLD OBJECTS", WIDTH / 2, 476);
      context.fillText("GRAB FOOD FOR A BOOST", WIDTH / 2, 516);
      context.fillStyle = COLORS.yellow;
      context.font = "700 20px Courier New";
      context.fillText("TAP A BUTTON TO RUN", WIDTH / 2, 606);
    } else {
      context.fillStyle = COLORS.red;
      context.font = "700 29px Courier New";
      context.fillText("CAUGHT!", WIDTH / 2, 384);
      context.fillStyle = COLORS.white;
      context.font = "700 18px Courier New";
      context.fillText("VET APPOINTMENT DELAYED BY", WIDTH / 2, 430);
      context.fillStyle = COLORS.yellow;
      context.font = "700 46px Courier New";
      context.fillText(formatTime(state.time), WIDTH / 2, 488);
      context.fillStyle = COLORS.white;
      context.font = "700 18px Courier New";
      context.fillText(`BEST ${formatTime(state.best)}`, WIDTH / 2, 526);
      context.fillStyle = COLORS.mint;
      context.font = "700 20px Courier New";
      context.fillText("TAP A BUTTON TO TRY AGAIN", WIDTH / 2, 604);
    }
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60);
    const tenths = Math.floor((seconds % 1) * 10);
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}.${tenths}`;
  }

  function draw() {
    context.save();
    if (state.shake > 0) {
      const strength = state.shake * 15;
      context.translate((Math.random() - 0.5) * strength, (Math.random() - 0.5) * strength);
    }
    drawBackground();
    drawOwner();
    for (const object of state.objects) drawObject(object);
    drawCat();

    for (const particle of state.particles) {
      context.globalAlpha = Math.min(1, particle.life * 2);
      context.fillStyle = particle.color;
      context.fillRect(particle.x, particle.y, particle.size, particle.size);
    }
    context.globalAlpha = 1;
    drawHud();
    drawOverlay();
    if (state.flash > 0) {
      context.fillStyle = `rgb(233 109 109 / ${state.flash * 2.6})`;
      context.fillRect(0, 0, WIDTH, HEIGHT);
    }
    context.restore();
  }

  function frame(now) {
    const delta = Math.min(0.033, (now - state.lastTime) / 1000);
    state.lastTime = now;
    update(delta);
    draw();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
