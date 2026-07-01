(function(root) {
'use strict';

var commentBarrageSeq = 0;
var commentBarrage3D = {
  group: null,
  comments: [],
  active: [],
  localIndex: 0,
  nextSpawnAt: 0,
  lastPreset: -1,
  textureCache: {},
};
var commentBarrageBasisCache = null;
var commentBarrageViewportFitCache = null;

function ensureCommentBarrage3DGroup() {
  if (commentBarrage3D.group) return commentBarrage3D.group;
  if (typeof THREE === 'undefined' || !scene) return null;
  commentBarrage3D.group = new THREE.Group();
  commentBarrage3D.group.name = 'comment-barrage-3d-layer';
  commentBarrage3D.group.renderOrder = 36;
  commentBarrage3D.group.visible = false;
  scene.add(commentBarrage3D.group);
  return commentBarrage3D.group;
}
function commentBarragePaletteColor(profile) {
  var pal = stageLyrics && stageLyrics.palette || {};
  var fallback = '#d6f8ff';
  if (profile && profile.kind === 'requiem') fallback = '#d9b8ff';
  else if (profile && profile.kind === 'starfield') fallback = '#bfe8ff';
  else if (profile && profile.kind === 'groove') fallback = '#fff0b8';
  else if (profile && profile.kind === 'void-whisper') fallback = '#d8d6ff';
  return lyricThreeColor(pal.highlight || pal.primary || fallback, fallback, 0.46);
}
function makeCommentBarrageTextTexture(text, profile) {
  text = stripUnsupportedEmojiSafe(text).replace(/\s+/g, ' ').trim();
  var lines = wrapBarrageTextSafe(text, { maxCharsPerLine: 24, maxLines: 3 });
  if (!lines.length) return null;
  var canvas = document.createElement('canvas');
  var W = 1280;
  var H = 150 + Math.max(0, lines.length - 1) * 76;
  canvas.width = W;
  canvas.height = H;
  var ctx = canvas.getContext('2d');
  var maxWidth = W - 150;
  var textStyle = commentBarrageTextStyleSafe(lines.length);
  var fontSize = Math.max(26, Math.floor(Number(textStyle.fontSize) || (lines.length > 1 ? 42 : 48)));
  var minFontSize = Math.max(22, Math.floor(Number(textStyle.minFontSize) || 26));
  var fontWeight = Math.max(500, Math.min(900, Math.floor(Number(textStyle.weight) || 720)));
  var fontFamily = '"Noto Sans SC","PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",sans-serif';
  function setFont(size) {
    ctx.font = fontWeight + ' ' + size + 'px ' + fontFamily;
  }
  setFont(fontSize);
  var measured = lines.reduce(function(max, line){ return Math.max(max, ctx.measureText(line).width); }, 1);
  while (fontSize > minFontSize && measured > maxWidth) {
    fontSize -= 3;
    setFont(fontSize);
    measured = lines.reduce(function(max, line){ return Math.max(max, ctx.measureText(line).width); }, 1);
  }
  measured = Math.max(1, Math.min(maxWidth, measured));
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  var color = commentBarragePaletteColor(profile);
  var rgb = {
    r: Math.round(color.r * 255),
    g: Math.round(color.g * 255),
    b: Math.round(color.b * 255),
  };
  var glowA = profile && profile.kind === 'void-whisper' ? 0.18 : 0.28;
  var lineHeight = Math.max(40, Number(textStyle.lineHeight) || fontSize * 1.15);
  var startY = H * 0.5 - (lines.length - 1) * lineHeight * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = 'blur(18px)';
  ctx.globalAlpha = glowA;
  ctx.fillStyle = 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')';
  lines.forEach(function(line, i){ ctx.fillText(line, W / 2, startY + i * lineHeight); });
  ctx.filter = 'blur(44px)';
  ctx.globalAlpha = glowA * 0.62;
  lines.forEach(function(line, i){ ctx.fillText(line, W / 2, startY + i * lineHeight); });
  ctx.restore();
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(5, fontSize * 0.075);
  ctx.strokeStyle = 'rgba(0,0,0,0.34)';
  lines.forEach(function(line, i){ ctx.strokeText(line, W / 2, startY + i * lineHeight + fontSize * 0.018); });
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  lines.forEach(function(line, i){ ctx.fillText(line, W / 2, startY + i * lineHeight); });
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  var grad = ctx.createLinearGradient(W / 2 - measured / 2, 0, W / 2 + measured / 2, 0);
  grad.addColorStop(0, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.70)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.96)');
  grad.addColorStop(1, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.80)');
  ctx.fillStyle = grad;
  lines.forEach(function(line, i){ ctx.fillText(line, W / 2, startY + i * lineHeight); });
  ctx.restore();
  var tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  if (renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy) {
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }
  return {
    texture: tex,
    width: W,
    height: H,
    textWidth: measured,
    worldW: clampRange(1.58 + measured / maxWidth * 3.20, 1.70, 4.85),
    worldH: clampRange(0.46 + (lines.length - 1) * 0.28, 0.48, 1.10),
  };
}
function buildCommentBarrageTextMesh(comment, profile, seq) {
  if (typeof THREE === 'undefined' || !comment || !comment.text) return null;
  var cleanText = stripUnsupportedEmojiSafe(comment.text);
  if (!cleanText) return null;
  profile = profile || commentBarrageVisualProfileSafe(fx && fx.preset);
  var tex = makeCommentBarrageTextTexture(cleanText, profile);
  if (!tex) return null;
  var mat = new THREE.MeshBasicMaterial({
    map: tex.texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  var mesh = new THREE.Mesh(new THREE.PlaneGeometry(tex.worldW, tex.worldH, 1, 1), mat);
  mesh.renderOrder = 37;
  mesh.frustumCulled = false;
  var seed = (seq * 97.13 + String(comment.id || comment.text).length * 13.7) % 997;
  function fract(v) { return v - Math.floor(v); }
  var randA = fract(Math.sin(seed * 12.9898) * 43758.5453);
  var randB = fract(Math.sin(seed * 78.233) * 12731.313);
  var randC = fract(Math.sin(seed * 37.719) * 8317.127);
  var laneOffset = commentBarrageLaneOffsetSafe(seq, profile.maxActive || 5, profile);
  var laneJitterY = Math.min(0.20, Math.max(0.10, (Number(profile.spreadY) || 2) * 0.07));
  mesh.userData.commentBarrage = {
    seq: seq,
    start: uniforms && uniforms.uTime ? uniforms.uTime.value : performance.now() / 1000,
    duration: Math.max(4.2, Number(profile.durationSec) || 9),
    profile: profile,
    seed: seed,
    randA: randA,
    randB: randB,
    randC: randC,
    lane: laneOffset.lane,
    laneSign: laneOffset.y < 0 ? -1 : 1,
    x: laneOffset.x + (randA - 0.5) * (profile.spreadX || 3.8),
    y: laneOffset.y + (randB - 0.5) * laneJitterY,
    z: laneOffset.z + (randC - 0.5) * (profile.spreadZ || 0.8),
    scale: 0.84 + fract(randA + randB) * 0.22,
    spin: (fract(randC + randA) - 0.5) * 0.16,
    opacity: 0.78 + fract(randB + randC) * 0.20,
  };
  return mesh;
}
function retargetCommentBarrageMesh(mesh, profile, seqOverride) {
  var d = mesh && mesh.userData && mesh.userData.commentBarrage;
  if (!d || !profile) return;
  var seq = seqOverride == null ? (Number(d.seq) || 0) : seqOverride;
  var laneOffset = commentBarrageLaneOffsetSafe(seq, profile.maxActive || 8, profile);
  var laneJitterY = Math.min(0.20, Math.max(0.10, (Number(profile.spreadY) || 2) * 0.07));
  var randA = Number.isFinite(d.randA) ? d.randA : 0.5;
  var randB = Number.isFinite(d.randB) ? d.randB : 0.5;
  var randC = Number.isFinite(d.randC) ? d.randC : 0.5;
  d.profile = profile;
  d.seq = seq;
  d.duration = Math.max(4.2, Number(profile.durationSec) || Number(d.duration) || 9);
  d.lane = laneOffset.lane;
  d.laneSign = laneOffset.y < 0 ? -1 : 1;
  d.x = laneOffset.x + (randA - 0.5) * (profile.spreadX || 3.8);
  d.y = laneOffset.y + (randB - 0.5) * laneJitterY;
  d.z = laneOffset.z + (randC - 0.5) * (profile.spreadZ || 0.8);
}
function retireCommentBarrageMesh(mesh) {
  var d = mesh && mesh.userData && mesh.userData.commentBarrage;
  if (!d || d.expired) return;
  d.expired = true;
  d.expireStart = uniforms && uniforms.uTime ? uniforms.uTime.value : performance.now() / 1000;
  d.expireDuration = 1.15;
}
function disposeCommentBarrageMesh(mesh) {
  if (!mesh) return;
  if (mesh.parent) mesh.parent.remove(mesh);
  if (mesh.material) {
    if (mesh.material.map && mesh.material.map.dispose) mesh.material.map.dispose();
    mesh.material.dispose();
  }
  if (mesh.geometry) mesh.geometry.dispose();
}
function clearCommentBarrage3D(keepComments) {
  if (commentBarrage3D.active && commentBarrage3D.active.length) {
    commentBarrage3D.active.forEach(disposeCommentBarrageMesh);
  }
  commentBarrage3D.active = [];
  commentBarrage3D.localIndex = 0;
  commentBarrage3D.nextSpawnAt = 0;
  if (!keepComments) commentBarrage3D.comments = [];
  if (commentBarrage3D.group) commentBarrage3D.group.visible = false;
}
function syncCommentBarrageButton() {
  var btn = document.getElementById('comment-barrage-btn');
  var layer = document.getElementById('comment-barrage-layer');
  if (btn) {
    btn.classList.toggle('active', !!commentBarrageEnabled);
    btn.setAttribute('aria-pressed', commentBarrageEnabled ? 'true' : 'false');
    btn.title = commentBarrageEnabled ? '关闭评论弹幕' : '开启评论弹幕';
  }
  if (layer) layer.classList.toggle('active', !!commentBarrageEnabled);
}
function clearCommentBarrageLayer(keepComments) {
  if (commentBarrageTimer) {
    clearInterval(commentBarrageTimer);
    commentBarrageTimer = null;
  }
  var layer = document.getElementById('comment-barrage-layer');
  if (layer) layer.innerHTML = '';
  clearCommentBarrage3D(!!keepComments);
}
function setCommentBarrageEnabled(on, silent) {
  commentBarrageEnabled = !!on;
  localStorage.setItem(COMMENT_BARRAGE_STORE_KEY, commentBarrageEnabled ? '1' : '0');
  syncCommentBarrageButton();
  if (!commentBarrageEnabled) {
    clearCommentBarrageLayer();
    if (!silent) showToast('评论弹幕已关闭');
    return;
  }
  if (!silent) showToast('评论弹幕已开启');
  resetCommentBarrageForCurrentSong('toggle-on');
}
function toggleCommentBarrage() {
  setCommentBarrageEnabled(!commentBarrageEnabled, false);
}
function spawnCommentBarrageItem(comment) {
  if (!commentBarrageEnabled || !comment || !comment.text) return;
  if (!shouldShowCommentBarrageSafe(currentCoverSong())) return;
  var group = ensureCommentBarrage3DGroup();
  if (!group) return;
  var seq = commentBarrageSeq++;
  var profile = commentBarrageVisualProfileSafe(fx && fx.preset);
  var maxActive = Math.max(4, Math.min(14, Math.floor(Number(profile.maxActive) || 8)));
  while (commentBarrage3D.active.filter(function(item){
    var d = item && item.userData && item.userData.commentBarrage;
    return d && !d.expired;
  }).length >= maxActive) {
    var oldest = commentBarrage3D.active.find(function(item){
      var d = item && item.userData && item.userData.commentBarrage;
      return d && !d.expired;
    });
    if (!oldest) break;
    retireCommentBarrageMesh(oldest);
  }
  var mesh = buildCommentBarrageTextMesh(comment, profile, seq);
  if (!mesh) return;
  group.visible = true;
  group.add(mesh);
  commentBarrage3D.active.push(mesh);
}
function startCommentBarrageLoop(comments) {
  clearCommentBarrageLayer();
  syncCommentBarrageButton();
  if (!shouldShowCommentBarrageSafe(currentCoverSong())) return;
  if (!commentBarrageEnabled || !comments || !comments.length) return;
  commentBarrage3D.comments = comments.slice();
  commentBarrage3D.localIndex = 0;
  commentBarrage3D.nextSpawnAt = 0;
  commentBarrage3D.lastPreset = fx && fx.preset;
  ensureCommentBarrage3DGroup();
}
function resetCommentBarrageVisualForPreset() {
  clearCommentBarrage3D(true);
  commentBarrage3D.lastPreset = fx && fx.preset;
  commentBarrage3D.nextSpawnAt = 0;
}
function applyCommentBarrageFxLive(reason) {
  if (!commentBarrage3D) return;
  var profile = commentBarrageVisualProfileSafe(fx && fx.preset);
  var maxActive = Math.max(4, Math.min(14, Math.floor(Number(profile.maxActive) || 8)));
  var active = commentBarrage3D.active || [];
  for (var i = 0; i < active.length; i++) retargetCommentBarrageMesh(active[i], profile, i);
  var visibleCount = active.filter(function(item){
    var d = item && item.userData && item.userData.commentBarrage;
    return d && !d.expired;
  }).length;
  for (var j = 0; visibleCount > maxActive && j < active.length; j++) {
    var data = active[j] && active[j].userData && active[j].userData.commentBarrage;
    if (data && !data.expired) {
      retireCommentBarrageMesh(active[j]);
      visibleCount -= 1;
    }
  }
  commentBarrage3D.active = active;
  commentBarrage3D.lastPreset = fx && fx.preset;
  if (commentBarrageEnabled && commentBarrage3D.comments && commentBarrage3D.comments.length && active.length < maxActive) {
    commentBarrage3D.nextSpawnAt = 0;
  }
  if (commentBarrage3D.group) commentBarrage3D.group.visible = !!(active.length || (commentBarrage3D.comments && commentBarrage3D.comments.length));
}
function commentBarrageVisualBasis(profile) {
  if (!commentBarrageBasisCache && typeof THREE !== 'undefined') {
    commentBarrageBasisCache = {
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scaleVec: new THREE.Vector3(1, 1, 1),
      right: new THREE.Vector3(1, 0, 0),
      up: new THREE.Vector3(0, 1, 0),
      forward: new THREE.Vector3(0, 0, 1),
      scale: 1,
    };
  }
  var basis = commentBarrageBasisCache;
  if (!basis) return null;
  var binding = commentBarrageMotionBindingSafe();
  var anchor = null;
  if (binding && binding.anchor === 'visual-world') {
    var skullPresetIndex = typeof SKULL_PRESET_INDEX !== 'undefined' ? SKULL_PRESET_INDEX : -1;
    if (fx && fx.preset === skullPresetIndex && skullParticleGroup && skullParticleGroup.visible) anchor = skullParticleGroup;
    else if (particles && particles.visible) anchor = particles;
    else if (backCoverGroup && backCoverGroup.visible) anchor = backCoverGroup;
    else if (floatGroup && floatGroup.visible) anchor = floatGroup;
  }
  if (anchor) {
    anchor.updateMatrixWorld(true);
    anchor.getWorldPosition(basis.position);
    anchor.getWorldQuaternion(basis.quaternion);
    anchor.getWorldScale(basis.scaleVec);
    basis.scale = clampRange((Math.abs(basis.scaleVec.x) + Math.abs(basis.scaleVec.y) + Math.abs(basis.scaleVec.z)) / 3, 0.35, 2.8);
  } else {
    basis.position.set(0, 0, 0);
    basis.quaternion.identity();
    basis.scaleVec.set(1, 1, 1);
    basis.scale = 1;
  }
  basis.right.set(1, 0, 0).applyQuaternion(basis.quaternion).normalize();
  basis.up.set(0, 1, 0).applyQuaternion(basis.quaternion).normalize();
  basis.forward.set(0, 0, 1).applyQuaternion(basis.quaternion).normalize();
  return basis;
}
function commentBarrageLyricQuaternion(basis) {
  if (stageLyrics && stageLyrics.group) {
    stageLyrics.group.updateMatrixWorld(true);
    return stageLyrics.group.quaternion;
  }
  if (basis && basis.quaternion) return basis.quaternion;
  return camera ? camera.quaternion : null;
}
function commentBarrageViewportCache() {
  if (!commentBarrageViewportFitCache && typeof THREE !== 'undefined') {
    commentBarrageViewportFitCache = {
      corners: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
      world: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      forward: new THREE.Vector3(),
    };
  }
  return commentBarrageViewportFitCache;
}
function commentBarrageProjectedRect(mesh) {
  if (!mesh || !mesh.geometry || !camera || typeof THREE === 'undefined') return null;
  var params = mesh.geometry.parameters || {};
  var w = Math.max(0.01, Number(params.width) || 1);
  var h = Math.max(0.01, Number(params.height) || 0.4);
  var cache = commentBarrageViewportCache();
  if (!cache) return null;
  var corners = cache.corners;
  corners[0].set(-w * 0.5, -h * 0.5, 0);
  corners[1].set(w * 0.5, -h * 0.5, 0);
  corners[2].set(w * 0.5, h * 0.5, 0);
  corners[3].set(-w * 0.5, h * 0.5, 0);
  mesh.updateMatrixWorld(true);
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (var i = 0; i < corners.length; i++) {
    corners[i].applyMatrix4(mesh.matrixWorld).project(camera);
    if (!isFinite(corners[i].x) || !isFinite(corners[i].y)) return null;
    var sx = (corners[i].x * 0.5 + 0.5) * innerWidth;
    var sy = (-corners[i].y * 0.5 + 0.5) * innerHeight;
    minX = Math.min(minX, sx);
    maxX = Math.max(maxX, sx);
    minY = Math.min(minY, sy);
    maxY = Math.max(maxY, sy);
  }
  return { left: minX, top: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}
function commentBarrageLyricSafeRect() {
  var w = Math.max(1, innerWidth || 1);
  var h = Math.max(1, innerHeight || 1);
  var shelfDetailOpen = !!(shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent());
  var safeW = shelfDetailOpen ? 0.48 : 0.56;
  var safeH = shelfDetailOpen ? 0.23 : 0.26;
  return {
    left: w * (0.5 - safeW * 0.5),
    top: h * (0.5 - safeH * 0.5),
    width: w * safeW,
    height: h * safeH,
  };
}
function fitCommentBarrageMeshToViewport(mesh) {
  if (!mesh || !camera || !camera.isPerspectiveCamera) return;
  var rect = commentBarrageProjectedRect(mesh);
  if (!rect) return;
  var fit = fitBarrageRectToViewportSafe(rect, { width: innerWidth, height: innerHeight }, {
    margin: Math.max(44, Math.min(86, Math.min(innerWidth, innerHeight) * 0.060)),
    lyricRect: commentBarrageLyricSafeRect(),
  });
  if (!fit || !fit.changed) return;
  var cache = commentBarrageViewportCache();
  if (!cache) return;
  mesh.getWorldPosition(cache.world);
  cache.forward.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  cache.right.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
  cache.up.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  var distance = Math.max(0.35, Math.abs(cache.world.clone().sub(camera.position).dot(cache.forward)));
  var fov = (camera.fov || 45) * Math.PI / 180;
  var visibleH = 2 * Math.tan(fov * 0.5) * distance;
  var visibleW = visibleH * (camera.aspect || (innerWidth / Math.max(1, innerHeight)) || 1.78);
  var worldPerPxX = visibleW / Math.max(1, innerWidth);
  var worldPerPxY = visibleH / Math.max(1, innerHeight);
  var pushX = clampRange(Number(fit.dx) || 0, -innerWidth * 0.24, innerWidth * 0.24);
  var pushY = clampRange(Number(fit.dy) || 0, -innerHeight * 0.24, innerHeight * 0.24);
  mesh.position.addScaledVector(cache.right, pushX * worldPerPxX * 0.82);
  mesh.position.addScaledVector(cache.up, -pushY * worldPerPxY * 0.82);
  var fitScale = clampRange(Number(fit.scale) || 1, 0.44, 1);
  if (fitScale < 0.995) mesh.scale.multiplyScalar(fitScale);
}
function commentBarrageApplyPresetPose(mesh, profile, ageSec, durationSec, nowT, exitAlpha) {
  var d = mesh && mesh.userData && mesh.userData.commentBarrage;
  if (!mesh || !d || !profile) return;
  var duration = Math.max(0.1, Number(durationSec) || Number(profile.durationSec) || 9);
  var progress = duration > 0 ? (Number(ageSec) || 0) / duration : 0;
  var p = clampRange(progress || 0, 0, 1);
  var ease = p * p * (3 - 2 * p);
  var alpha = commentBarrageOpacityAtSafe(ageSec, duration) * (exitAlpha == null ? 1 : exitAlpha) * (profile.opacity || 0.7) * d.opacity;
  var x = (profile.x || 0) + d.x + (profile.driftX || 0) * ease;
  var y = (profile.y || 0) + d.y + (profile.driftY || 0) * ease;
  var z = (profile.z || 0) + d.z + (profile.driftZ || 0) * ease;
  var rotZ = d.spin * ease;
  var scale = (profile.scale || 0.55) * d.scale * (1 + Math.min(0.16, beatPulse * 0.08 + bass * 0.035));
  var phase = nowT * 0.64 + d.seed * 0.017;
  if (profile.kind === 'tunnel-echo') {
    z -= ease * 1.12;
    scale *= 1.08 - ease * 0.18;
    rotZ += Math.sin(phase) * 0.045;
  } else if (profile.kind === 'orbital') {
    var orbitA = phase + ease * Math.PI * 0.86;
    x += Math.cos(orbitA) * 0.64;
    y += Math.sin(orbitA) * 0.26;
    z += Math.sin(orbitA * 0.7) * 0.20;
    rotZ += Math.sin(orbitA) * 0.08;
  } else if (profile.kind === 'void-whisper') {
    y += Math.sin(phase * 0.54) * 0.10;
    alpha *= 0.78 + 0.22 * Math.sin(phase * 1.7 + ease * 2.0);
  } else if (profile.kind === 'groove') {
    var groove = (ease - 0.5) * Math.PI;
    x += Math.sin(groove) * 0.42;
    y += Math.cos(groove) * 0.12;
    rotZ += Math.sin(groove) * 0.12;
  } else if (profile.kind === 'starfield') {
    z -= ease * 0.52;
    x += Math.sin(phase * 0.72) * 0.12;
    y += Math.cos(phase * 0.58) * 0.10;
    alpha *= 0.74 + 0.26 * Math.pow(0.5 + 0.5 * Math.sin(phase * 2.4), 2);
  } else if (profile.kind === 'requiem') {
    x += Math.sin(phase * 0.62) * 0.08;
    y += Math.sin(phase * 1.18) * 0.045 - ease * 0.12;
    rotZ += Math.sin(phase * 2.3) * 0.030;
  } else {
    y += Math.sin(phase) * 0.055;
    z += Math.cos(phase * 0.6) * 0.055;
  }
  var safeY = Math.max(1.0, Number(profile.lyricSafeY) || 1.08);
  if (Math.abs(y) < safeY) y = (d.laneSign < 0 ? -1 : 1) * safeY;
  var basis = commentBarrageVisualBasis(profile);
  if (basis) {
    mesh.position.copy(basis.position)
      .addScaledVector(basis.right, x)
      .addScaledVector(basis.up, y)
      .addScaledVector(basis.forward, z);
    var binding = commentBarrageMotionBindingSafe();
    var lyricQuat = commentBarrageLyricQuaternion(basis);
    if (binding && (binding.billboard === 'lyric-rotation' || binding.rotation === 'lyric') && lyricQuat) mesh.quaternion.copy(lyricQuat);
    else if (camera && binding && binding.billboard === 'camera-facing') mesh.quaternion.copy(camera.quaternion);
    else mesh.quaternion.copy(basis.quaternion);
    mesh.rotateX(((profile.tiltX || 0) * Math.PI / 180) * (1 - ease * 0.25));
    mesh.rotateY(((profile.tiltY || 0) * Math.PI / 180) * (1 - ease * 0.18));
    mesh.rotateZ(rotZ);
    scale *= basis.scale;
  } else {
    mesh.position.set(x, y, z);
    mesh.rotation.set((profile.tiltX || 0) * Math.PI / 180, (profile.tiltY || 0) * Math.PI / 180, rotZ);
  }
  mesh.scale.setScalar(scale);
  fitCommentBarrageMeshToViewport(mesh);
  if (mesh.material) mesh.material.opacity = clampRange(alpha, 0, 1);
}
function updateCommentBarrage3D(dt) {
  if (!commentBarrageEnabled || !shouldShowCommentBarrageSafe(currentCoverSong())) {
    if (commentBarrage3D.active && commentBarrage3D.active.length) clearCommentBarrage3D(true);
    if (commentBarrage3D.group) commentBarrage3D.group.visible = false;
    return;
  }
  var group = ensureCommentBarrage3DGroup();
  if (!group) return;
  var comments = commentBarrage3D.comments || [];
  group.visible = !!(comments.length || (commentBarrage3D.active && commentBarrage3D.active.length));
  if (!comments.length && (!commentBarrage3D.active || !commentBarrage3D.active.length)) return;
  var preset = fx && fx.preset;
  if (commentBarrage3D.lastPreset !== preset) {
    resetCommentBarrageVisualForPreset();
    commentBarrage3D.lastPreset = preset;
  }
  var profile = commentBarrageVisualProfileSafe(preset);
  var nowMs = performance.now();
  if (comments.length && nowMs >= (commentBarrage3D.nextSpawnAt || 0)) {
    var next = comments[commentBarrage3D.localIndex % comments.length];
    commentBarrage3D.localIndex += 1;
    spawnCommentBarrageItem(next);
    commentBarrage3D.nextSpawnAt = nowMs + Math.max(300, Math.min(2400, Number(profile.spawnMs) || 1100));
  }
  var nowT = uniforms && uniforms.uTime ? uniforms.uTime.value : nowMs / 1000;
  for (var i = commentBarrage3D.active.length - 1; i >= 0; i--) {
    var mesh = commentBarrage3D.active[i];
    var data = mesh && mesh.userData && mesh.userData.commentBarrage;
    if (!data) {
      commentBarrage3D.active.splice(i, 1);
      disposeCommentBarrageMesh(mesh);
      continue;
    }
    var age = nowT - data.start;
    var duration = Math.max(4.2, Number(data.duration) || Number(profile.durationSec) || 9);
    if (age >= duration && !data.expired) data.expired = true;
    var exitAlpha = 1;
    if (data.expired) {
      if (data.expireStart == null) data.expireStart = nowT;
      if (data.expireDuration == null) data.expireDuration = 1.15;
      var exitAge = Math.max(0, nowT - data.expireStart);
      var exitProgress = clampRange(exitAge / Math.max(0.1, data.expireDuration), 0, 1);
      exitAlpha = 1 - exitProgress * exitProgress * (3 - 2 * exitProgress);
      if (exitAge >= data.expireDuration || age >= duration + data.expireDuration) {
        commentBarrage3D.active.splice(i, 1);
        disposeCommentBarrageMesh(mesh);
        continue;
      }
    }
    commentBarrageApplyPresetPose(mesh, data.profile || profile, age, duration, nowT, exitAlpha);
  }
}

function init() {
  return {
    ensureGroup: ensureCommentBarrage3DGroup,
    clear: clearCommentBarrage3D,
    syncButton: syncCommentBarrageButton,
    clearLayer: clearCommentBarrageLayer,
    setEnabled: setCommentBarrageEnabled,
    toggle: toggleCommentBarrage,
    spawn: spawnCommentBarrageItem,
    startLoop: startCommentBarrageLoop,
    resetVisualForPreset: resetCommentBarrageVisualForPreset,
    applyFxLive: applyCommentBarrageFxLive,
    update: updateCommentBarrage3D,
    getState: function() { return commentBarrage3D; },
  };
}

root.MineradioCommentBarrage3D = {
  init: init,
};
if (typeof window !== 'undefined') window.MineradioCommentBarrage3D = root.MineradioCommentBarrage3D;
})(typeof window !== 'undefined' ? window : globalThis);
