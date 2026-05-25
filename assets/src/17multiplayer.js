(function () {
  var COLORS = {
    RED: "red",
    GREEN: "green",
    BLUE: "blue",
    "8 BALL": "black",
    SOLIDS: "red",
    STRIPES: "blue",
    ANY: "black"
  };

  var PoolNet = {
    room: null,
    roomId: "",
    playerId: "",
    localSlot: "",
    eventSource: null,
    mode: 0,
    started: false,
    waitingForRemoteSync: false,
    localShotPending: false,
    shotRunningLastFrame: false,
    settleFrames: 0,
    threePlayerPostShotHandled: false,
    lastMenuRenderKey: "",
    lastLobbyRenderKey: "",
    uiReady: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function getMenuEl() {
    return $("pool-online-menu");
  }

  function getLobbyEl() {
    return $("pool-online-lobby");
  }

  function getTurnEl() {
    return $("pool-online-turn");
  }

  function getHudEl() {
    return $("pool-online-hud");
  }

  function hide(el) {
    if (el) {
      el.classList.add("hidden");
    }
  }

  function show(el) {
    if (el) {
      el.classList.remove("hidden");
    }
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char];
    });
  }

  function getStateName() {
    try {
      return game && game.state && game.state.current ? game.state.current : "";
    } catch (error) {
      return "";
    }
  }

  function isClassicMode() {
    return PoolNet.mode === 2;
  }

  function onlineActive() {
    return !!projectInfo && !!projectInfo.networked && !!PoolNet.roomId;
  }

  function currentGameInfo() {
    return window.playState && playState.gameInfo ? playState.gameInfo : null;
  }

  function playerLabel(slot) {
    if (slot === "p1") {
      return "Player 1";
    }
    if (slot === "p2") {
      return "Player 2";
    }
    return "Player 3";
  }

  function targetForSlot(gi, slot) {
    if (!gi) {
      return "WAIT";
    }
    if (gi.playerTargetTypeMap && gi.playerTargetTypeMap[slot]) {
      return gi.playerTargetTypeMap[slot];
    }
    if (slot === "p1") {
      return gi.p1TargetType || "ANY";
    }
    if (slot === "p2") {
      return gi.p2TargetType || "ANY";
    }
    return gi.p3TargetType || "GREEN";
  }

  function turnMessage(gi) {
    if (!gi) {
      return "Connecting match";
    }
    if (gi.gameOver) {
      return gi.winner ? playerLabel(gi.winner) + " wins" : "Match over";
    }
    return gi.turn === PoolNet.localSlot ? "Your shot" : playerLabel(gi.turn) + " is at the table";
  }

  function updateTurnOverlay() {
    var overlay = getTurnEl();
    if (!overlay) {
      return;
    }
    if (!onlineActive() || getStateName() !== "play") {
      hide(overlay);
      return;
    }
    hide(overlay);
  }

  function updateHud() {
    var hud = getHudEl();
    if (!hud) {
      return;
    }
    var gi = currentGameInfo();
    var inPlay = getStateName() === "play";
    var threePlayerView = inPlay && (projectInfo.mode === 3 || onlineActive());
    if (!threePlayerView || !gi) {
      hide(hud);
      return;
    }
    var slots = projectInfo.mode === 3 ? ["p1", "p2", "p3"] : ["p1", "p2"];
    var html = "";
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var target = targetForSlot(gi, slot);
      var tone = COLORS[target] || "black";
      var active = gi.turn === slot ? " active" : "";
      var suffix = slot === PoolNet.localSlot && onlineActive() ? " (You)" : "";
      html += '<div class="hud-pill' + active + '"><span class="hud-name">' + escapeHtml(playerLabel(slot) + suffix) + '</span><span class="hud-target ' + tone + '">' + escapeHtml(target) + "</span></div>";
    }
    hud.innerHTML = html;
    show(hud);
  }

  function setMenuMessage(message) {
    var node = $("pool-online-menu-message");
    if (node) {
      node.textContent = message || "";
    }
  }

  function setLobbyMessage(message) {
    var node = $("pool-online-lobby-message");
    if (node) {
      node.textContent = message || "";
    }
  }

  function renderMenu() {
    var menu = getMenuEl();
    if (!menu) {
      return;
    }
    menu.innerHTML = '' +
      "<h2>Online Rooms</h2>" +
      "<p>Classic 2-player stays exactly as 8-ball. Tricolor 3-player deals 5 red, 5 blue, 5 green, plus the black ball.</p>" +
      '<input id="pool-online-name" maxlength="18" placeholder="Your display name" value="Player" />' +
      '<div class="pool-grid">' +
      '<button class="primary" id="pool-create-classic">Create Classic</button>' +
      '<button class="primary" id="pool-create-tricolor">Create Tricolor</button>' +
      "</div>" +
      '<div class="pool-join">' +
      '<input id="pool-room-code" maxlength="5" placeholder="Room code" />' +
      '<button class="secondary" id="pool-join-room">Join</button>' +
      "</div>" +
      '<div class="pool-message" id="pool-online-menu-message"></div>' +
      '<div class="pool-small">Run this project through <code>node server.js</code> so friends can join the same room URL.</div>';
    $("pool-create-classic").onclick = function () {
      createRoom(2);
    };
    $("pool-create-tricolor").onclick = function () {
      createRoom(3);
    };
    $("pool-join-room").onclick = function () {
      joinRoom();
    };
    PoolNet.lastMenuRenderKey = "menu";
  }

  function renderLobby() {
    var lobby = getLobbyEl();
    if (!lobby || !PoolNet.room) {
      return;
    }
    var room = PoolNet.room;
    var playerList = room.players.map(function (player) {
      var mine = player.id === PoolNet.playerId ? " (You)" : "";
      return "<li><span>" + escapeHtml(playerLabel(player.slot) + mine) + "</span><strong>" + escapeHtml(player.name) + "</strong></li>";
    }).join("");
    var status = room.mode === 3 ? "Tricolor online" : "Classic online";
    var canStart = room.hostId === PoolNet.playerId && room.players.length === room.maxPlayers && !room.started;
    lobby.innerHTML = '' +
      "<h2>Room Lobby</h2>" +
      '<div class="room-line"><span>' + escapeHtml(status) + '</span><span class="code">' + escapeHtml(room.id) + "</span></div>" +
      "<p>Share this room code with the other players, then start when every slot is filled.</p>" +
      "<ul>" + playerList + "</ul>" +
      '<div class="pool-message" id="pool-online-lobby-message"></div>' +
      '<div class="lobby-actions">' +
      (canStart ? '<button class="primary" id="pool-start-room">Start Match</button>' : "") +
      '<button class="secondary" id="pool-copy-room">Copy Code</button>' +
      '<button class="danger" id="pool-close-room">Close</button>' +
      "</div>";
    if (canStart) {
      $("pool-start-room").onclick = startRoom;
    }
    $("pool-copy-room").onclick = function () {
      navigator.clipboard.writeText(room.id).then(function () {
        setLobbyMessage("Room code copied.");
      }, function () {
        setLobbyMessage("Copy failed. Share the code manually.");
      });
    };
    $("pool-close-room").onclick = function () {
      disconnectRoom();
      refreshShell();
    };
    PoolNet.lastLobbyRenderKey = JSON.stringify({
      id: room.id,
      mode: room.mode,
      started: room.started,
      hostId: room.hostId,
      players: room.players.map(function (player) {
        return {
          id: player.id,
          name: player.name,
          slot: player.slot
        };
      })
    });
  }

  function lobbyRenderKey() {
    if (!PoolNet.room) {
      return "";
    }
    return JSON.stringify({
      id: PoolNet.room.id,
      mode: PoolNet.room.mode,
      started: PoolNet.room.started,
      hostId: PoolNet.room.hostId,
      players: PoolNet.room.players.map(function (player) {
        return {
          id: player.id,
          name: player.name,
          slot: player.slot
        };
      })
    });
  }

  function refreshShell() {
    if (!PoolNet.uiReady) {
      return;
    }
    var inMenu = getStateName() === "mainMenu";
    if (!PoolNet.room && inMenu) {
      if (PoolNet.lastMenuRenderKey !== "menu") {
        renderMenu();
      }
      show(getMenuEl());
      hide(getLobbyEl());
    } else {
      hide(getMenuEl());
      PoolNet.lastMenuRenderKey = "";
    }
    if (PoolNet.room && !PoolNet.started) {
      if (PoolNet.lastLobbyRenderKey !== lobbyRenderKey()) {
        renderLobby();
      }
      show(getLobbyEl());
    } else {
      hide(getLobbyEl());
      PoolNet.lastLobbyRenderKey = "";
    }
    updateTurnOverlay();
    updateHud();
  }

  function fetchJson(url, options) {
    return fetch(url, options).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) {
          throw new Error(payload.error || "Request failed");
        }
        return payload;
      });
    });
  }

  function playerName() {
    var input = $("pool-online-name");
    var value = input ? input.value.trim() : "";
    return value || "Player";
  }

  function createRoom(mode) {
    setMenuMessage("Creating room...");
    fetchJson("/api/create-room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: playerName(),
        mode: mode
      })
    }).then(function (data) {
      PoolNet.room = data.room;
      PoolNet.roomId = data.room.id;
      PoolNet.playerId = data.playerId;
      PoolNet.localSlot = "p1";
      PoolNet.mode = data.room.mode;
      attachEvents();
      refreshShell();
    }).catch(function (error) {
      setMenuMessage(error.message);
    });
  }

  function joinRoom() {
    var roomCodeInput = $("pool-room-code");
    var roomId = roomCodeInput ? roomCodeInput.value.trim().toUpperCase() : "";
    if (!roomId) {
      setMenuMessage("Enter a room code.");
      return;
    }
    setMenuMessage("Joining room...");
    fetchJson("/api/join-room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: roomId,
        name: playerName()
      })
    }).then(function (data) {
      PoolNet.room = data.room;
      PoolNet.roomId = data.room.id;
      PoolNet.playerId = data.playerId;
      PoolNet.mode = data.room.mode;
      var me = data.room.players.filter(function (player) {
        return player.id === data.playerId;
      })[0];
      PoolNet.localSlot = me ? me.slot : "";
      attachEvents();
      refreshShell();
    }).catch(function (error) {
      setMenuMessage(error.message);
    });
  }

  function disconnectRoom() {
    if (PoolNet.eventSource) {
      PoolNet.eventSource.close();
    }
    PoolNet.room = null;
    PoolNet.roomId = "";
    PoolNet.playerId = "";
    PoolNet.localSlot = "";
    PoolNet.mode = 0;
    PoolNet.started = false;
    PoolNet.eventSource = null;
    PoolNet.waitingForRemoteSync = false;
    PoolNet.localShotPending = false;
    PoolNet.settleFrames = 0;
    PoolNet.lastMenuRenderKey = "";
    PoolNet.lastLobbyRenderKey = "";
    if (projectInfo) {
      projectInfo.networked = false;
      projectInfo.networkMode = "";
    }
  }

  function attachEvents() {
    if (!PoolNet.roomId) {
      return;
    }
    if (PoolNet.eventSource) {
      PoolNet.eventSource.close();
    }
    PoolNet.eventSource = new EventSource("/api/rooms/" + PoolNet.roomId + "/events");
    PoolNet.eventSource.onmessage = function (event) {
      var data = JSON.parse(event.data);
      handleServerEvent(data);
    };
    PoolNet.eventSource.onerror = function () {
      setLobbyMessage("Connection hiccup. Retrying...");
    };
  }

  function handleServerEvent(data) {
    if (data.type === "room_state") {
      PoolNet.room = data.room;
      PoolNet.mode = data.room.mode;
      if (data.snapshot && onlineActive() && getStateName() === "play") {
        applySnapshot(data.snapshot);
      }
      refreshShell();
      return;
    }
    if (data.type === "match_started") {
      PoolNet.room = data.room;
      PoolNet.mode = data.room.mode;
      PoolNet.started = true;
      launchNetworkMatch();
      refreshShell();
      return;
    }
    if (data.type === "room_action") {
      if (data.actionType === "shot-start") {
        if (data.from !== PoolNet.localSlot) {
          PoolNet.waitingForRemoteSync = false;
          PoolNet.threePlayerPostShotHandled = false;
          applyLiveState(data.payload);
        }
        return;
      }
      if (data.actionType === "sync-state" || data.actionType === "game-over") {
        if (data.from !== PoolNet.localSlot) {
          PoolNet.waitingForRemoteSync = false;
          applySnapshot(data.payload);
        }
      }
    }
  }

  function startRoom() {
    setLobbyMessage("Starting match...");
    fetchJson("/api/start-room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: PoolNet.roomId,
        playerId: PoolNet.playerId
      })
    }).catch(function (error) {
      setLobbyMessage(error.message);
    });
  }

  function launchNetworkMatch() {
    if (!projectInfo) {
      return;
    }
    projectInfo.networked = true;
    projectInfo.networkMode = "online";
    projectInfo.mode = PoolNet.mode;
    projectInfo.levelName = PoolNet.mode === 3 ? "3players_online" : "2players_online";
    projectInfo.tutorial = false;
    projectInfo.clickedHelpButton = false;
    projectInfo.lastBreaker = "none";
    if (getStateName() !== "play") {
      game.state.start("play");
    }
  }

  function serializeSnapshot(gi) {
    return {
      turn: gi.turn,
      winner: gi.winner || "",
      gameOver: !!gi.gameOver,
      shotNum: gi.shotNum || 0,
      cueBallInHand: !!gi.cueBallInHand,
      p1TargetType: gi.p1TargetType || "ANY",
      p2TargetType: gi.p2TargetType || "ANY",
      p3TargetType: gi.p3TargetType || "GREEN",
      playerTargetTypeMap: gi.playerTargetTypeMap || { p1: "RED", p2: "BLUE", p3: "GREEN" },
      pottedBallArray: (gi.pottedBallArray || []).slice(),
      balls: gi.ballArray.map(function (ball) {
        return {
          id: ball.id,
          x: ball.position.x,
          y: ball.position.y,
          active: !!ball.active,
          visible: !!ball.mc.visible,
          targetType: ball.targetType || ""
        };
      })
    };
  }

  function serializeLiveState(gi) {
    return {
      turn: gi.turn,
      winner: gi.winner || "",
      gameOver: !!gi.gameOver,
      shotRunning: !!gi.shotRunning,
      shotNum: gi.shotNum || 0,
      cueBallInHand: !!gi.cueBallInHand,
      p1TargetType: gi.p1TargetType || "ANY",
      p2TargetType: gi.p2TargetType || "ANY",
      p3TargetType: gi.p3TargetType || "GREEN",
      playerTargetTypeMap: gi.playerTargetTypeMap || { p1: "RED", p2: "BLUE", p3: "GREEN" },
      balls: gi.ballArray.map(function (ball) {
        return {
          id: ball.id,
          x: ball.position.x,
          y: ball.position.y,
          vx: ball.velocity ? ball.velocity.x : 0,
          vy: ball.velocity ? ball.velocity.y : 0,
          active: !!ball.active,
          visible: !!ball.mc.visible,
          targetType: ball.targetType || "",
          grip: typeof ball.grip === "number" ? ball.grip : 1,
          ySpin: typeof ball.ySpin === "number" ? ball.ySpin : 0,
          screw: typeof ball.screw === "number" ? ball.screw : 0,
          english: typeof ball.english === "number" ? ball.english : 0
        };
      })
    };
  }

  function applySnapshot(snapshot) {
    var gi = currentGameInfo();
    if (!snapshot || !gi || !gi.ballArray) {
      return;
    }
    for (var i = 0; i < gi.ballArray.length; i++) {
      var ball = gi.ballArray[i];
      var source = snapshot.balls[i];
      if (!source) {
        continue;
      }
      ball.position.x = source.x;
      ball.position.y = source.y;
      ball.velocity = new Vector2D(0, 0);
      ball.active = source.active;
      ball.targetType = source.targetType || ball.targetType;
      if (ball.mc) {
        ball.mc.visible = source.visible;
      }
      if (ball.shadow) {
        ball.shadow.visible = source.active && source.visible !== false;
      }
    }
    gi.turn = snapshot.turn;
    gi.winner = snapshot.winner;
    gi.gameOver = snapshot.gameOver;
    gi.shotNum = snapshot.shotNum;
    gi.cueBallInHand = snapshot.cueBallInHand;
    gi.p1TargetType = snapshot.p1TargetType;
    gi.p2TargetType = snapshot.p2TargetType;
    gi.p3TargetType = snapshot.p3TargetType;
    gi.playerTargetTypeMap = snapshot.playerTargetTypeMap || gi.playerTargetTypeMap;
    gi.pottedBallArray = snapshot.pottedBallArray || [];
    gi.shotRunning = false;
    gi.shotComplete = false;
    gi.rulingsApplied = false;
    gi.beginStrike = false;
    gi.settingPower = false;
    gi.cueSet = false;
    gi.shotReset = true;
    gi.turnArrow1.frame = gi.turn === "p1" ? 1 : 0;
    gi.turnArrow2.frame = gi.turn === "p2" ? 1 : 0;
    gi.numBalls = gi.ballArray.filter(function (ball) {
      return ball.active;
    }).length;
    gi.ballsRemaining = Math.max(0, gi.numBalls - 1);
    rearmTurnState(gi);
    if (window.renderScreen) {
      renderScreen();
    }
    updateHud();
    updateTurnOverlay();
  }

  function applyLiveState(liveState) {
    var gi = currentGameInfo();
    if (!liveState || !gi || !gi.ballArray) {
      return;
    }
    for (var i = 0; i < gi.ballArray.length; i++) {
      var ball = gi.ballArray[i];
      var source = liveState.balls[i];
      if (!source) {
        continue;
      }
      ball.position.x = source.x;
      ball.position.y = source.y;
      ball.velocity = new Vector2D(source.vx || 0, source.vy || 0);
      ball.active = source.active;
      ball.targetType = source.targetType || ball.targetType;
      ball.grip = typeof source.grip === "number" ? source.grip : ball.grip;
      ball.ySpin = typeof source.ySpin === "number" ? source.ySpin : ball.ySpin;
      if (typeof source.screw === "number") {
        ball.screw = source.screw;
      }
      if (typeof source.english === "number") {
        ball.english = source.english;
      }
      if (ball.mc) {
        ball.mc.visible = source.visible;
      }
      if (ball.shadow) {
        ball.shadow.visible = source.active && source.visible !== false;
      }
    }
    gi.turn = liveState.turn;
    gi.winner = liveState.winner;
    gi.gameOver = liveState.gameOver;
    gi.shotRunning = !!liveState.shotRunning;
    gi.shotNum = liveState.shotNum;
    gi.cueBallInHand = !!liveState.cueBallInHand;
    gi.p1TargetType = liveState.p1TargetType;
    gi.p2TargetType = liveState.p2TargetType;
    gi.p3TargetType = liveState.p3TargetType;
    gi.playerTargetTypeMap = liveState.playerTargetTypeMap || gi.playerTargetTypeMap;
    gi.shotComplete = false;
    gi.rulingsApplied = false;
    gi.beginStrike = false;
    gi.settingPower = false;
    gi.cueSet = false;
    gi.gameRunning = true;
    if (gi.cueCanvas) {
      gi.cueCanvas.visible = false;
      gi.cueCanvas.alpha = 1;
    }
    if (gi.guideCanvas) {
      gi.guideCanvas.visible = false;
    }
    if (window.renderScreen) {
      renderScreen();
    }
  }

  function rearmTurnState(gi) {
    var cueBall = gi.ballArray && gi.ballArray[0];
    if (!cueBall) {
      return;
    }
    gi.gameRunning = true;
    gi.foulWindow.visible = false;
    gi.popUpPanel.visible = false;
    gi.foulDisplayComplete = true;
    gi.cueSet = false;
    gi.lockAim = false;
    gi.executeStrike = false;
    gi.settingPower = false;
    gi.settingSpin = false;
    gi.beginStrike = false;
    gi.startAim = false;
    gi.cueTweenComplete = false;
    gi.preventAim = false;
    gi.preventSetPower = false;
    gi.preventUpdateCue = false;
    gi.drawGuide = true;
    gi.shotReset = true;
    gi.shotComplete = false;
    gi.rulingsApplied = false;
    gi.scratched = false;
    gi.fouled = false;
    gi.turnExtended = false;
    gi.ballsPotted = 0;
    gi.typesPotted = "";
    gi.ballsPottedSameType = false;
    gi.placeFirstTimeMouseUp = false;
    gi.moverMouseDown = false;
    gi.moverMouseOver = false;
    gi.power = 0;
    cueBall.active = true;
    if (cueBall.shadow) {
      cueBall.shadow.visible = true;
    }
    if (cueBall.mc) {
      cueBall.mc.visible = true;
    }
    if (gi.cueCanvas) {
      gi.cueCanvas.visible = true;
      gi.cueCanvas.alpha = 1;
      gi.cueCanvas.x = cueBall.position.x * gi.physScale;
      gi.cueCanvas.y = cueBall.position.y * gi.physScale;
    }
    if (gi.cue) {
      gi.cue.x = -gi.ballRadius * gi.physScale * 1.5;
    }
    if (gi.cueShadow) {
      gi.cueShadow.x = gi.cue ? gi.cue.x : 0;
    }
    if (gi.guideCanvas) {
      gi.guideCanvas.visible = true;
    }
    if (gi.powerBarMask) {
      gi.powerBarMask.x = 0;
      gi.powerBarMask.y = 0;
    }
    for (var i = 0; i < gi.ballArray.length; i++) {
      gi.ballArray[i].lastCollisionObject = null;
      gi.ballArray[i].firstContact = false;
      gi.ballArray[i].contactArray = [];
    }
  }

  function canFinalizeShotSync(gi) {
    if (!gi || gi.shotRunning) {
      return false;
    }
    if (gi.beginStrike || gi.settingPower || gi.settingSpin) {
      return false;
    }
    if (gi.foulDisplayComplete === false) {
      return false;
    }
    if (gi.foulWindow && gi.foulWindow.visible) {
      return false;
    }
    if (gi.popUpPanel && gi.popUpPanel.visible) {
      return false;
    }
    if (!gi.shotReset && !gi.gameOver) {
      return false;
    }
    if (!gi.gameRunning && !gi.gameOver) {
      return false;
    }
    return true;
  }

  function ensureActivePlayerReady(gi) {
    if (!onlineActive() || !gi || gi.turn !== PoolNet.localSlot || gi.shotRunning || gi.gameOver) {
      return;
    }
    if (!canFinalizeShotSync(gi)) {
      return;
    }
    gi.gameRunning = true;
    gi.preventAim = false;
    gi.preventSetPower = false;
    gi.preventUpdateCue = false;
    gi.settingPower = false;
    gi.settingSpin = false;
    gi.beginStrike = false;
    gi.startAim = false;
    gi.moverMouseDown = false;
    gi.moverMouseOver = false;
    gi.drawGuide = true;
    if (gi.cueCanvas) {
      gi.cueCanvas.visible = true;
      gi.cueCanvas.alpha = 1;
    }
    if (gi.guideCanvas) {
      gi.guideCanvas.visible = true;
    }
  }

  function enforceSpectatorLock(gi) {
    if (!onlineActive() || !gi || gi.turn === PoolNet.localSlot) {
      return;
    }
    gi.preventAim = true;
    gi.preventSetPower = true;
    gi.preventUpdateCue = true;
    gi.settingPower = false;
    gi.beginStrike = false;
    gi.startAim = false;
    gi.moverMouseDown = false;
    gi.moverMouseOver = false;
    if (gi.cueCanvas && !gi.shotRunning) {
      gi.cueCanvas.visible = false;
    }
    if (gi.guideCanvas && !gi.shotRunning) {
      gi.guideCanvas.visible = false;
    }
  }

  function postAction(type, payload) {
    if (!PoolNet.roomId || !PoolNet.playerId) {
      return Promise.resolve();
    }
    return fetchJson("/api/room-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: PoolNet.roomId,
        playerId: PoolNet.playerId,
        type: type,
        payload: payload
      })
    });
  }

  function shouldSyncAfterShot(gi) {
    if (!onlineActive() || !PoolNet.localShotPending) {
      return false;
    }
    if (!canFinalizeShotSync(gi)) {
      return false;
    }
    for (var i = 0; i < gi.ballArray.length; i++) {
      if (gi.ballArray[i].velocity && gi.ballArray[i].velocity.magnitude > 0) {
        return false;
      }
    }
    return true;
  }

  function installUi() {
    if (PoolNet.uiReady) {
      return;
    }
    PoolNet.uiReady = true;
    renderMenu();
    refreshShell();
  }

  function patchPlayState() {
    if (!window.playState || playState._onlinePatched) {
      return;
    }
    playState._onlinePatched = true;
    var originalCreate = playState.create;
    var originalUpdate = playState.update;
    playState.create = function () {
      originalCreate.apply(this, arguments);
      var gi = playState.gameInfo;
      PoolNet.shotRunningLastFrame = false;
      PoolNet.localShotPending = false;
      PoolNet.settleFrames = 0;
      PoolNet.threePlayerPostShotHandled = false;
      if (projectInfo.mode === 3) {
        gi.rackSolids.visible = false;
        gi.rackStripes.visible = false;
        gi.humanIcon.visible = false;
        gi.aiIcon.visible = false;
        gi.turnArrow1.visible = false;
        gi.turnArrow2.visible = false;
      }
      updateHud();
      updateTurnOverlay();
    };
    playState.update = function () {
      enforceSpectatorLock(playState.gameInfo);
      originalUpdate.apply(this, arguments);
      var gi = playState.gameInfo;
      if (!gi) {
        return;
      }
      if (projectInfo.mode === 3) {
        if (gi.shotRunning) {
          PoolNet.threePlayerPostShotHandled = false;
        } else if (gi.shotComplete && !gi.gameOver && !PoolNet.threePlayerPostShotHandled) {
          PoolNet.threePlayerPostShotHandled = true;
          rearmTurnState(gi);
          gi.shotComplete = false;
          if (window.renderScreen) {
            renderScreen();
          }
        }
        if (gi.timerStarted && !projectInfo.tutorial && typeof updateTimer === "function") {
          updateTimer();
        }
      }
      ensureActivePlayerReady(gi);
      updateHud();
      updateTurnOverlay();
      if (!onlineActive()) {
        return;
      }
      if (gi.shotRunning && !PoolNet.shotRunningLastFrame && gi.turn === PoolNet.localSlot) {
        PoolNet.localShotPending = true;
        PoolNet.settleFrames = 0;
        PoolNet.waitingForRemoteSync = true;
        postAction("shot-start", serializeLiveState(gi));
      }
      PoolNet.shotRunningLastFrame = gi.shotRunning;
      if (shouldSyncAfterShot(gi)) {
        PoolNet.settleFrames += 1;
        if (PoolNet.settleFrames > 10) {
          PoolNet.localShotPending = false;
          PoolNet.settleFrames = 0;
          postAction(gi.gameOver ? "game-over" : "sync-state", serializeSnapshot(gi)).then(function () {
            PoolNet.waitingForRemoteSync = false;
          }, function () {
            PoolNet.waitingForRemoteSync = false;
          });
        }
      } else {
        PoolNet.settleFrames = 0;
      }
    };
  }

  function fitMenuModeButtons(info) {
    if (!info || !info.pVpButton || !info.pV3Button || !info.pVAIButton || !window.game) {
      return;
    }
    var isPortrait = window.famobi && window.famobi.getOrientation && window.famobi.getOrientation() === "portrait";
    var spacing = isPortrait ? 18 : 30;
    var maxRowWidth = Math.min(game.width * (isPortrait ? 0.84 : 0.48), isPortrait ? 860 : 700);
    var targetButtonWidth = (maxRowWidth - spacing * 2) / 3;
    var minScale = isPortrait ? 0.42 : 0.38;
    var maxScale = isPortrait ? 0.6 : 0.5;
    var buttonScale = Math.max(minScale, Math.min(maxScale, targetButtonWidth / 460));
    var offset = 460 * buttonScale + spacing;
    var rowShift = isPortrait ? 0 : Math.min(120, game.width * 0.06);
    var rowY = isPortrait ? game.height * 0.03 : game.height * 0.08;
    var buttons = [info.pVpButton, info.pV3Button, info.pVAIButton];
    buttons.forEach(function (button) {
      button.scale.setTo(buttonScale, buttonScale);
      button.y = rowY;
    });
    info.pVpButton.x = rowShift - offset;
    info.pV3Button.x = rowShift;
    info.pVAIButton.x = rowShift + offset;
  }

  function patchMenuState() {
    if (!window.menuState || menuState._onlinePatched) {
      return;
    }
    menuState._onlinePatched = true;
    var originalCreate = menuState.create;
    menuState.create = function () {
      originalCreate.apply(this, arguments);
      var info = menuState.menuInfo;
      if (typeof menuState.resizeGame === "function" && !menuState.resizeGame._onlineScaled) {
        var originalResize = menuState.resizeGame;
        var wrappedResize = function () {
          originalResize.apply(this, arguments);
          fitMenuModeButtons(menuState.menuInfo);
        };
        wrappedResize._onlineScaled = true;
        menuState.resizeGame = wrappedResize;
      }
      if (info && info.menuCanvas && info.pVpButton && info.pVpButton.parent !== info.menuCanvas) {
        info.menuCanvas.addChild(info.pVpButton);
      }
      fitMenuModeButtons(info);
      refreshShell();
    };
    var originalShutdown = menuState.shutdown;
    menuState.shutdown = function () {
      hide(getMenuEl());
      hide(getLobbyEl());
      if (originalShutdown) {
        originalShutdown.apply(this, arguments);
      }
    };
  }

  function bootWhenReady() {
    installUi();
    patchMenuState();
    patchPlayState();
    refreshShell();
    requestAnimationFrame(bootWhenReady);
  }

  bootWhenReady();
}());
