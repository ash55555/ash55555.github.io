// A little table-fun d20 roller. Loaded after three.js (CDN) and after script.js.
// Self-contained: doesn't depend on anything in script.js, and vice versa.

document.addEventListener('DOMContentLoaded', function () {
  var stage = document.getElementById('canvas-stage');
  if (!stage || typeof THREE === 'undefined') return;

  var D20_TABLE = [
    "The DM brings snacks to the next session 🍕",
    "Your character can only lie for their next 3 statements",
    "Everyone picks a silly voice for one NPC this session",
    "Your character is convinced they've met one NPC before (they haven't)",
    "The party votes on a new group nickname for the session",
    "Your character has to compliment every enemy before attacking them",
    "Whoever rolled this picks the music for next session",
    "Your character develops a sudden, strong opinion about hats",
    "The DM has to describe the next combat entirely in food metaphors",
    "Your character can only speak in questions for the next 10 minutes",
    "Everyone shares their character's most embarrassing memory",
    "Your character refuses to use their strongest ability this fight, out of pride",
    "The table takes a 5-minute snack break, no arguments",
    "Your character starts every sentence with \"Actually…\" for the next scene",
    "Whoever rolled this gets to name the next tavern",
    "Your character is oddly formal with one specific party member for the rest of the session",
    "The DM lets the party retcon one small detail from last session",
    "Your character can't stop talking about a recipe they \"invented\"",
    "Everyone at the table has to high-five before the next roll",
    "Your character becomes convinced they're the chosen one (they're not)"
  ];

  var hintEl = document.getElementById('d20-hint');
  var resultWrap = document.getElementById('d20-result');
  var resultNum = document.getElementById('d20-result-num');
  var resultText = document.getElementById('d20-result-text');

  var width = stage.clientWidth || 280;
  var height = stage.clientHeight || 280;

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(32, width / height, 1, 20);
  camera.position.set(0, 0, 6.4);

  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.inset = '0';
  renderer.domElement.style.zIndex = '0';
  stage.insertBefore(renderer.domElement, stage.firstChild);

  scene.add(new THREE.AmbientLight(0x2a1a45, 1.3));
  var purpleLight = new THREE.PointLight(0x9b6dff, 3.0, 20);
  purpleLight.position.set(-3.5, 2.5, 4);
  scene.add(purpleLight);
  var cyanLight = new THREE.PointLight(0x7ecbff, 2.0, 20);
  cyanLight.position.set(3.5, -1.5, 3.5);
  scene.add(cyanLight);
  var keyLight = new THREE.PointLight(0xffffff, 1.1, 20);
  keyLight.position.set(0, 4, 5);
  scene.add(keyLight);

  var geo = new THREE.IcosahedronGeometry(1.6, 0);
  var mat = new THREE.MeshPhysicalMaterial({
    color: 0x5b2fae,
    emissive: 0x7a3fd6,
    emissiveIntensity: 0.4,
    metalness: 0.25,
    roughness: 0.28,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
    flatShading: true
  });
  var die = new THREE.Mesh(geo, mat);
  scene.add(die);

  var edgesGeo = new THREE.EdgesGeometry(geo);
  var edgePos = edgesGeo.attributes.position;
  var edgeCount = Math.floor(edgePos.count / 2);
  var goldMat = new THREE.MeshStandardMaterial({
    color: 0xf2c96b,
    metalness: 0.7,
    roughness: 0.25,
    emissive: 0x6b4b12,
    emissiveIntensity: 0.3
  });
  var upAxis = new THREE.Vector3(0, 1, 0);
  for (var e = 0; e < edgeCount; e++) {
    var pA = new THREE.Vector3().fromBufferAttribute(edgePos, e * 2);
    var pB = new THREE.Vector3().fromBufferAttribute(edgePos, e * 2 + 1);
    var mid = pA.clone().add(pB).multiplyScalar(0.5);
    var dir = pB.clone().sub(pA);
    var len = dir.length();
    var edgeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, len, 6), goldMat);
    edgeMesh.position.copy(mid);
    edgeMesh.quaternion.setFromUnitVectors(upAxis, dir.clone().normalize());
    die.add(edgeMesh);
  }

  var pos = geo.attributes.position;
  var faceCount = Math.floor(pos.count / 3);
  var faceNormals = [];

  function makeNumberTexture(n) {
    var size = 192;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#f7d68a';
    ctx.font = 'bold 132px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(20,8,35,0.85)';
    ctx.shadowBlur = 10;
    ctx.fillText(String(n), size / 2, size / 2 - 13);
    var tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  for (var f = 0; f < faceCount; f++) {
    var ia = f * 3, ib = f * 3 + 1, ic = f * 3 + 2;
    var vA = new THREE.Vector3().fromBufferAttribute(pos, ia);
    var vB = new THREE.Vector3().fromBufferAttribute(pos, ib);
    var vC = new THREE.Vector3().fromBufferAttribute(pos, ic);
    var centroid = vA.clone().add(vB).add(vC).divideScalar(3);
    var normal = centroid.clone().normalize();
    faceNormals.push(normal);

    var numMat = new THREE.MeshBasicMaterial({ map: makeNumberTexture(f + 1), transparent: true, alphaTest: 0.5, depthTest: true, depthWrite: true });
    var numPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 1.08), numMat);
    numPlane.position.copy(centroid).multiplyScalar(1.06);
    numPlane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    die.add(numPlane);
  }

  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();

  // ---- Idle float (only before the first roll; a landed result should hold still) ----
  var idleSpeed = { x: 0.003, y: 0.0045 };
  var rolling = false;
  var dragging = false;
  var hasRolled = false;
  var lastPointer = null;

  function tickIdle() {
    if (!rolling && !dragging && !hasRolled) {
      die.rotation.x += idleSpeed.x;
      die.rotation.y += idleSpeed.y;
    }
    requestAnimationFrame(tickIdle);
  }
  tickIdle();

  // ---- Drag to rotate manually ----
  function pointerPos(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }
  var dragMoved = false;
  function onPointerDown(e) {
    if (rolling) return;
    dragging = true;
    dragMoved = false;
    lastPointer = pointerPos(e);
  }
  function onPointerMove(e) {
    if (!dragging) return;
    var p = pointerPos(e);
    var dx = p.x - lastPointer.x;
    var dy = p.y - lastPointer.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
    die.rotation.y += dx * 0.012;
    die.rotation.x += dy * 0.012;
    lastPointer = p;
  }
  function onPointerUp() { dragging = false; }

  stage.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);
  stage.addEventListener('touchstart', onPointerDown, { passive: true });
  window.addEventListener('touchmove', onPointerMove, { passive: true });
  window.addEventListener('touchend', onPointerUp);

  // ---- Roll ----
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function doRoll() {
    if (rolling) return;
    rolling = true;
    hasRolled = true;
    hintEl.textContent = 'Rolling…';
    resultWrap.hidden = true;

    var finalRoll = Math.floor(Math.random() * 20) + 1;

    var spinDuration = reducedMotion ? 0 : 700;
    var settleDuration = reducedMotion ? 0 : 500;
    var spinSpeed = { x: 0.35, y: 0.5, z: 0.12 };
    var spinStart = performance.now();

    function spinFrame(now) {
      var t = (now - spinStart) / spinDuration;
      if (t >= 1 || spinDuration === 0) {
        startSettle();
        return;
      }
      die.rotation.x += spinSpeed.x;
      die.rotation.y += spinSpeed.y;
      die.rotation.z += spinSpeed.z;
      requestAnimationFrame(spinFrame);
    }

    function startSettle() {
      var startQuat = die.quaternion.clone();
      var targetLocalNormal = faceNormals[finalRoll - 1].clone().normalize();
      var targetQuat = new THREE.Quaternion().setFromUnitVectors(targetLocalNormal, new THREE.Vector3(0, 0, 1));
      var settleStart = performance.now();

      function settleFrame(now) {
        var t = Math.min((now - settleStart) / Math.max(settleDuration, 1), 1);
        var eased = easeOutCubic(t);
        die.quaternion.copy(startQuat).slerp(targetQuat, eased);
        if (t < 1 && settleDuration > 0) {
          requestAnimationFrame(settleFrame);
        } else {
          die.quaternion.copy(targetQuat);
          finishRoll();
        }
      }
      requestAnimationFrame(settleFrame);
    }

    function finishRoll() {
      hintEl.textContent = 'Tap to roll again';
      resultNum.textContent = String(finalRoll);
      resultText.textContent = D20_TABLE[finalRoll - 1];
      resultWrap.hidden = false;
      rolling = false;
    }

    requestAnimationFrame(spinFrame);
  }

  stage.addEventListener('click', function () {
    if (dragging || dragMoved) {
      dragMoved = false;
      return;
    }
    doRoll();
  });
  stage.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      doRoll();
    }
  });
});
