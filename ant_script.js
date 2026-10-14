(function(){
  "use strict";
  var canvas = document.getElementById('cv10');
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0;

  // pheromone grid
  var GW = 125, GH = 70, GS = 8; // 8px cells
  var pher = [new Float32Array(GW*GH), new Float32Array(GW*GH), new Float32Array(GW*GH)];
  var pherCanvas = document.createElement('canvas');
  pherCanvas.width = GW; pherCanvas.height = GH;
  var soilCanvas = document.createElement('canvas');
  var pherCtx = pherCanvas.getContext('2d');
  var pherImg = pherCtx.createImageData(GW, GH);

  var COLONIES = [
    {name:'Red',  color:'#ff6b6b', rgb:[255,80,80]},
    {name:'Blue', color:'#6b9bff', rgb:[80,140,255]},
    {name:'Gold', color:'#ffd24a', rgb:[255,210,74]}
  ];
  // nests at equilateral triangle vertices (equal pixel distances)
  var NEST_ANGLES = [-Math.PI/2, Math.PI/6, Math.PI*5/6];
  var ANTS_PER = 334;
  var WIN_FOOD = 500;

  var ants = [];
  var foods = []; // {x,y,amount}
  var banked = [0,0,0];
  var obstacles = []; // {x,y,r,type}
  var nestFlow = [null, null, null];
  var foundFood = [[], [], []];
  var battles = []; // {x,y,t} death flashes
  var respawning = [false, false, false];
  var assassin = null; // {x,y,angle,speed,stack}
  var spider = null; // {x,y,angle,speed,state,web,ex,ey}
  var kills = [[0,0,0],[0,0,0],[0,0,0]]; // per colony: [workers, foragers, warriors] killed
  var events = []; // {t, text}
  var windAnim = null; // {angle, t, dur, lines:[{x,y,len,spd}]}
  var peakAnts = [0,0,0], minAnts = [1e9,1e9,1e9], totalSpawned = [0,0,0];
  var predKills = {spider:[0,0,0], assassin:[0,0,0], combat:[0,0,0], warrior:[0,0,0]};
  var foodHist = [[],[],[]]; // sampled every 5 sec
  var milestones = [{},{},{}]; // food milestones hit per colony
  var attackCooldown = [0,0,0]; // per-colony discovered food locations
  var started = false, winner = -1, bet = -1, worldReady = false;
  var simT = 0, frameCount = 0;

  var statusEl = document.getElementById('status10');
  var timerEl = document.getElementById('timer10');

  function resize(){
    var r = canvas.getBoundingClientRect();
    W = Math.max(320, Math.floor(r.width));
    H = 560;
    canvas.width = W; canvas.height = H;
    GS = W / GW;
    genSoil();
  }

  function shade(hex, f){
    var r = Math.min(255, parseInt(hex.slice(1,3), 16)*f);
    var g = Math.min(255, parseInt(hex.slice(3,5), 16)*f);
    var b = Math.min(255, parseInt(hex.slice(5,7), 16)*f);
    return 'rgb('+Math.round(r)+','+Math.round(g)+','+Math.round(b)+')';
  }

  function nestPos(c){
    // equilateral, vertically centered (equal top/bottom clearance)
    var a = NEST_ANGLES[c];
    var margin = 25;
    var rTop = H/2 - margin;
    var rX = (W/2 - margin) / 0.866;
    var rY = (H/2 - margin) / 0.5;
    var R = Math.min(rTop, rX, rY);
    var cy = H/2 + R*0.25; // shift down so top/bottom gaps match
    return {x: W/2 + Math.cos(a)*R, y: cy + Math.sin(a)*R};
  }

  function mulberry32(seed){
    return function(){
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function genSoil(){
    soilCanvas.width = W; soilCanvas.height = H;
    var rnd = mulberry32(1337);
    var sc = soilCanvas.getContext('2d');
    // base: mottled dark brown
    var bg = sc.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#241a10');
    bg.addColorStop(0.5, '#1e150c');
    bg.addColorStop(1, '#2a1e12');
    sc.fillStyle = bg;
    sc.fillRect(0, 0, W, H);
    // large soft blotches (moisture variation)
    for (var b = 0; b < 25; b++){
      var bx = rnd()*W, by = rnd()*H;
      var br = 60+rnd()*120;
      var grd = sc.createRadialGradient(bx, by, 0, bx, by, br);
      var dark = rnd() < 0.5;
      grd.addColorStop(0, dark ? 'rgba(10,6,3,0.35)' : 'rgba(80,55,30,0.18)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      sc.fillStyle = grd;
      sc.beginPath(); sc.arc(bx, by, br, 0, Math.PI*2); sc.fill();
    }
    // soil grains (the main ant-scale texture)
    for (var g = 0; g < 900; g++){
      var gx = rnd()*W, gy = rnd()*H;
      var gs = 2+rnd()*5;
      var tone = rnd();
      if (tone < 0.4) sc.fillStyle = '#3a2a18';
      else if (tone < 0.7) sc.fillStyle = '#2e2013';
      else if (tone < 0.9) sc.fillStyle = '#4a3520';
      else sc.fillStyle = '#1a120a';
      sc.save();
      sc.translate(gx, gy);
      sc.rotate(rnd()*Math.PI);
      sc.beginPath();
      sc.ellipse(0, 0, gs, gs*(0.6+rnd()*0.4), 0, 0, Math.PI*2);
      sc.fill();
      // grain highlight
      sc.fillStyle = 'rgba(255,230,180,0.08)';
      sc.beginPath();
      sc.ellipse(-gs*0.2, -gs*0.2, gs*0.4, gs*0.25, 0, 0, Math.PI*2);
      sc.fill();
      sc.restore();
    }
    // tiny grit specks
    for (var s2 = 0; s2 < 300; s2++){
      sc.fillStyle = rnd() < 0.5 ? 'rgba(200,170,120,0.25)' : 'rgba(0,0,0,0.3)';
      sc.fillRect(rnd()*W, rnd()*H, 1.5, 1.5);
    }
    // root fibers
    sc.strokeStyle = 'rgba(90,70,45,0.3)';
    sc.lineWidth = 1.5;
    for (var r2 = 0; r2 < 12; r2++){
      var rx = rnd()*W, ry = rnd()*H;
      sc.beginPath();
      sc.moveTo(rx, ry);
      sc.quadraticCurveTo(rx+(rnd()-0.5)*80, ry+(rnd()-0.5)*40,
                          rx+(rnd()-0.5)*120, ry+(rnd()-0.5)*60);
      sc.stroke();
    }
  }

  function clearOfNests(x, y, pad){
    for (var c = 0; c < 3; c++){
      var n = nestPos(c);
      var dx = x-n.x, dy = y-n.y;
      if (dx*dx+dy*dy < (90+pad)*(90+pad)) return false;
    }
    return true;
  }

  function genObstacles(){
    obstacles = [];
    // pebbles
    for (var i = 0; i < 28; i++){
      var px = 60+Math.random()*(W-120), py = 60+Math.random()*(H-120);
      if (!clearOfNests(px, py, 20)) continue;
      var pr = 12+Math.random()*18;
      var verts = [];
      var nv = 6 + (Math.random()*3|0);
      for (var vi = 0; vi < nv; vi++){
        verts.push(0.7 + Math.random()*0.55);
      }
      // per-facet shade variation
      var shades = [];
      for (var fi2 = 0; fi2 < nv; fi2++){
        shades.push(0.82 + Math.random()*0.36);
      }
      // cracks: 1-2 lines from edge toward center
      var cracks = [];
      var nc = 1 + (Math.random()*2|0);
      for (var ci2 = 0; ci2 < nc; ci2++){
        cracks.push({a: Math.random()*Math.PI*2, len: 0.4+Math.random()*0.4});
      }
      obstacles.push({x:px, y:py, r:pr, type:'rock', verts:verts, shades:shades, cracks:cracks});
    }
    // twigs: single obstacle with bark detail
    for (var t = 0; t < 7; t++){
      var tx = 80+Math.random()*(W-160), ty = 80+Math.random()*(H-160);
      if (!clearOfNests(tx, ty, 50)) continue;
      var ta = Math.random()*Math.PI;
      var tlen = 55+Math.random()*45;
      // bark stripes
      var bark = [];
      for (var bk = 0; bk < 7; bk++){
        bark.push({off: (Math.random()-0.5)*0.7, w: 0.8+Math.random()*1.5,
                   tone: 0.75+Math.random()*0.5});
      }
      // knots
      var knots = [];
      for (var kn = 0; kn < 2; kn++){
        knots.push({pos: (Math.random()-0.5)*0.7, s: 3+Math.random()*3});
      }
      // collision circles along the twig
      for (var sg = 0; sg < 5; sg++){
        obstacles.push({
          x: tx+Math.cos(ta)*(sg-2)*tlen/5,
          y: ty+Math.sin(ta)*(sg-2)*tlen/5,
          r: 8, type:'twigseg', ang: ta
        });
      }
      obstacles.push({x:tx, y:ty, r:tlen/2, type:'twig', ang:ta, len:tlen,
                      bark:bark, knots:knots, wid: 10+Math.random()*5});
    }
    // water droplets (slow zones, not solid)
    for (var w = 0; w < 5; w++){
      var wx = 80+Math.random()*(W-160), wy = 80+Math.random()*(H-160);
      if (!clearOfNests(wx, wy, 40)) continue;
      var wob = [];
      var nwob = 10 + (Math.random()*4|0);
      for (var wbi3 = 0; wbi3 < nwob; wbi3++){
        wob.push(0.75 + Math.random()*0.5);
      }
      var wr2 = 28+Math.random()*22;
      var bubs = [];
      var nbub = 3 + (Math.random()*4|0);
      for (var bubi = 0; bubi < nbub; bubi++){
        var ba = Math.random()*Math.PI*2;
        var bd = Math.random()*wr2*0.55;
        bubs.push({dx: Math.cos(ba)*bd, dy: Math.sin(ba)*bd*0.85,
                   r: 2+Math.random()*3.5});
      }
      obstacles.push({x:wx, y:wy, r:wr2, type:'water', wob:wob, bubs:bubs});
    }
    // spider webs (trap zones, min 200px apart)
    for (var sw = 0; sw < 2; sw++){
      var sx = 0, sy = 0, placed = false;
      for (var att = 0; att < 30 && !placed; att++){
        sx = 100+Math.random()*(W-200); sy = 100+Math.random()*(H-200);
        if (!clearOfNests(sx, sy, 60)) continue;
        placed = true;
        for (var wo = 0; wo < obstacles.length; wo++){
          var wob2 = obstacles[wo];
          if (wob2.type !== 'web') continue;
          var wdx = sx-wob2.x, wdy = sy-wob2.y;
          if (wdx*wdx+wdy*wdy < 200*200){ placed = false; break; }
        }
      }
      if (!placed) continue;
      var sr = 35+Math.random()*20;
      if (sw === 0) sr *= 2; // first web is twice the size
      var dew = [];
      for (var di = 0; di < 8; di++){
        dew.push({a: Math.random()*Math.PI*2, d: 0.3+Math.random()*0.6});
      }
      // irregular spoke angles (organic, not uniform)
      var spokes = [];
      var nsp = 9 + (Math.random()*4|0);
      var baseA = Math.random()*Math.PI*2;
      for (var spi0 = 0; spi0 < nsp; spi0++){
        spokes.push(baseA + spi0/nsp*Math.PI*2 + (Math.random()-0.5)*0.35);
      }
      // skip a random sector (real webs have gaps)
      var gapAt = (Math.random()*nsp)|0;
      spokes.splice(gapAt, 1);
      obstacles.push({x:sx, y:sy, r:sr, type:'web', dew:dew,
                      rot: Math.random()*Math.PI, spokes:spokes});
    }
    // fallen leaves (small, solid)
    var leafCols = ['#8a5a2a', '#a06a35', '#7a4a22', '#93502e', '#b0753a'];
    for (var lf = 0; lf < 58; lf++){
      var lx = 60+Math.random()*(W-120), ly = 60+Math.random()*(H-120);
      if (!clearOfNests(lx, ly, 25)) continue;
      var hasFung = Math.random() < 0.2;
      var fungSpots = [];
      if (hasFung){
        var nf = 4 + (Math.random()*4|0);
        for (var fsi = 0; fsi < nf; fsi++){
          fungSpots.push({a: Math.random()*Math.PI*2,
                          d: 0.55+Math.random()*0.35,
                          s: 3+Math.random()*3});
        }
      }
      obstacles.push({x:lx, y:ly, r:14+Math.random()*10, type:'leaf',
                      ang: Math.random()*Math.PI*2,
                      col: leafCols[(Math.random()*leafCols.length)|0],
                      curl: (Math.random()-0.5)*0.4,
                      hasFungus: hasFung, fungSpots: fungSpots});
    }
    // mushroom clusters (solid)
    for (var mc = 0; mc < 4; mc++){
      var mx = 80+Math.random()*(W-160), my = 80+Math.random()*(H-160);
      if (!clearOfNests(mx, my, 40)) continue;
      var shrooms = [];
      var nsh = 2 + (Math.random()*2|0);
      for (var shi = 0; shi < nsh; shi++){
        shrooms.push({
          dx: (Math.random()-0.5)*36, dy: (Math.random()-0.5)*24,
          h: (18+Math.random()*14)*1.2, capR: (10+Math.random()*8)*1.2,
          capCol: ['#c0392b', '#a93226', '#d35400'][(Math.random()*3)|0]
        });
      }
      obstacles.push({x:mx, y:my, r:30, type:'mushroom', shrooms:shrooms});
    }
  }

  function spawnSeed(){
    for (var t = 0; t < 20; t++){
      var fx = (0.15 + Math.random()*0.7) * W;
      var fy = (0.1 + Math.random()*0.8) * H;
      if (!clearOfNests(fx, fy, 120)) continue;
      var seeds = [];
      var ns = 8 + (Math.random()*8|0);
      for (var si = 0; si < ns; si++){
        var sa = Math.random()*Math.PI*2, sd = Math.random()*18;
        seeds.push({dx: Math.cos(sa)*sd, dy: Math.sin(sa)*sd*0.7,
                    r: 2.5+Math.random()*2, rot: Math.random()*Math.PI*2,
                    tone: 0.8+Math.random()*0.4});
      }
      foods.push({x:fx, y:fy, amount: ns, seeds: seeds, type:'seed', value:2});
      return;
    }
  }

  function spawnDeadBug(btype){
    for (var t = 0; t < 30; t++){
      var fx = (0.15 + Math.random()*0.7) * W;
      var fy = (0.1 + Math.random()*0.8) * H;
      if (!clearOfNests(fx, fy, 150)) continue;
      var val = btype === 'beetle' ? 5 : 3;
      var amt = btype === 'beetle' ? 12 : 8;
      foods.push({x:fx, y:fy, amount: amt, type:btype, value:val,
                  rot: Math.random()*Math.PI*2,
                  size: btype === 'beetle' ? 22 : (btype === 'cricket' ? 18 : 14)});
      return;
    }
  }

  function buildNestFlows(){
    var DX = [0,1,0,-1,1,1,-1,-1], DY = [-1,0,1,0,-1,1,1,-1];
    for (var c = 0; c < 3; c++){
      var blocked = new Uint8Array(GW*GH);
      for (var o = 0; o < obstacles.length; o++){
        var ob = obstacles[o];
        if (ob.type === 'water' || ob.type === 'twig' || ob.type === 'web' || ob.type === 'leaf') continue;
        var gx0 = Math.max(0, ((ob.x-ob.r)/W*GW)|0);
        var gx1 = Math.min(GW-1, ((ob.x+ob.r)/W*GW)|0);
        var gy0 = Math.max(0, ((ob.y-ob.r)/H*GH)|0);
        var gy1 = Math.min(GH-1, ((ob.y+ob.r)/H*GH)|0);
        for (var gy = gy0; gy <= gy1; gy++){
          for (var gx = gx0; gx <= gx1; gx++){
            var wx = (gx+0.5)/GW*W, wy = (gy+0.5)/GH*H;
            var ddx = wx-ob.x, ddy = wy-ob.y;
            if (ddx*ddx+ddy*ddy < (ob.r+4)*(ob.r+4)) blocked[gy*GW+gx] = 1;
          }
        }
      }
      var dist = new Int32Array(GW*GH).fill(-1);
      var n = nestPos(c);
      var nx = Math.max(0, Math.min(GW-1, (n.x/W*GW)|0));
      var ny = Math.max(0, Math.min(GH-1, (n.y/H*GH)|0));
      var start = ny*GW+nx;
      dist[start] = 0;
      var queue = [start], qh = 0;
      while (qh < queue.length){
        var cur = queue[qh++];
        var cx = cur % GW, cy = (cur/GW)|0;
        for (var d = 0; d < 8; d++){
          var ax = cx+DX[d], ay = cy+DY[d];
          if (ax < 0 || ax >= GW || ay < 0 || ay >= GH) continue;
          var ai = ay*GW+ax;
          if (blocked[ai] || dist[ai] !== -1) continue;
          dist[ai] = dist[cur]+1;
          queue.push(ai);
        }
      }
      nestFlow[c] = dist;
    }
  }

  function layCurvedTrail(col, fx, fy){
    var dist = nestFlow[col];
    if (!dist) return false;
    var DX = [0,1,0,-1,1,1,-1,-1], DY = [-1,0,1,0,-1,1,1,-1];
    var n = nestPos(col);
    var nx = Math.max(0, Math.min(GW-1, (n.x/W*GW)|0));
    var ny = Math.max(0, Math.min(GH-1, (n.y/H*GH)|0));
    var target = ny*GW+nx;
    var cur = Math.max(0, Math.min(GH-1, (fy/H*GH)|0))*GW +
              Math.max(0, Math.min(GW-1, (fx/W*GW)|0));
    if (dist[cur] === -1) return false;
    var steps = 0;
    while (cur !== target && steps++ < 6000){
      var wx = (cur%GW+0.5)/GW*W, wy = ((cur/GW|0)+0.5)/GH*H;
      depositPher(col, wx, wy, 16);
      var best = -1, bestD = dist[cur];
      var ccx = cur % GW, ccy = (cur/GW)|0;
      for (var d = 0; d < 8; d++){
        var ax = ccx+DX[d], ay = ccy+DY[d];
        if (ax < 0 || ax >= GW || ay < 0 || ay >= GH) continue;
        var ai = ay*GW+ax;
        if (dist[ai] !== -1 && dist[ai] < bestD){ bestD = dist[ai]; best = ai; }
      }
      if (best === -1) break;
      cur = best;
    }
    return true;
  }

  function inWater(x, y){
    for (var o = 0; o < obstacles.length; o++){
      var ob = obstacles[o];
      if (ob.type !== 'water') continue;
      var dx = x-ob.x, dy = y-ob.y;
      if (dx*dx+dy*dy < ob.r*ob.r) return true;
    }
    return false;
  }
  function onLeaf(x, y){
    for (var o = 0; o < obstacles.length; o++){
      var ob = obstacles[o];
      if (ob.type !== 'leaf') continue;
      var dx = x-ob.x, dy = y-ob.y;
      if (dx*dx+dy*dy < ob.r*ob.r*0.8) return true;
    }
    return false;
  }
  function terrainSpeed(x, y){
    if (inWater(x, y)) return 0.35;
    if (onLeaf(x, y)) return 0.2;
    return 1;
  }
  function pushLeaf(x, y, dx, dy){
    for (var o = 0; o < obstacles.length; o++){
      var ob = obstacles[o];
      if (ob.type !== 'leaf') continue;
      var lx = x-ob.x, ly = y-ob.y;
      if (lx*lx+ly*ly < ob.r*ob.r*0.8){
        ob.x -= dx*0.35;
        ob.y -= dy*0.35;
        // keep on screen
        ob.x = Math.max(20, Math.min(W-20, ob.x));
        ob.y = Math.max(20, Math.min(H-20, ob.y));
        break;
      }
    }
  }

  function collideObstacles(a){
    for (var o = 0; o < obstacles.length; o++){
      var ob = obstacles[o];
      if (ob.type === 'water' || ob.type === 'twig' || ob.type === 'web' || ob.type === 'leaf') continue;
      var dx = a.x-ob.x, dy = a.y-ob.y;
      var rr = ob.r + 2;
      var d2 = dx*dx+dy*dy;
      if (d2 < rr*rr){
        var d = Math.sqrt(d2) || 1;
        a.x = ob.x + dx/d*rr;
        a.y = ob.y + dy/d*rr;
        a.angle = Math.atan2(dy,dx) + (Math.random()-0.5)*1.2;
      }
    }
  }

  function spawnFoodCluster(){
    // spawn away from nests
    for (var t = 0; t < 20; t++){
      var fx = (0.2 + Math.random()*0.6) * W;
      var fy = (0.1 + Math.random()*0.8) * H;
      var ok = true;
      for (var c = 0; c < 3; c++){
        var n = nestPos(c);
        var dx = fx-n.x, dy = fy-n.y;
        if (dx*dx+dy*dy < 200*200){ ok = false; break; }
      }
      if (ok){
        for (var oi = 0; oi < obstacles.length; oi++){
          var ob2 = obstacles[oi];
          var odx = fx-ob2.x, ody = fy-ob2.y;
          if (odx*odx+ody*ody < (ob2.r+30)*(ob2.r+30)){ ok = false; break; }
        }
      }
      if (ok){
        var crystals = [];
        var nc = 96 + (Math.random()*54|0);
        for (var ci = 0; ci < nc; ci++){
          var ca = Math.random()*Math.PI*2;
          var cd = Math.random()*22;
          crystals.push({dx: Math.cos(ca)*cd, dy: Math.sin(ca)*cd*0.7,
                         s: 1.5+Math.random()*2.5, tw: Math.random()*Math.PI*2});
        }
        foods.push({x:fx, y:fy, amount: 60 + (Math.random()*60|0), crystals: crystals,
                    type:'sugar', value:1});
        return;
      }
    }
  }

  var EVENT_COLORS = {
    spider: '#b45fd0',    // purple
    attack: '#ff6b6b',    // red
    assassin: '#ff4da6',   // pink
    wind: '#9ad0ff',        // light blue
    milestone: '#6bff8a', // green
    respawn: '#ffb84d',   // orange
    victory: '#ffd700',   // gold
    info: '#e8e6e3'       // default
  };
  document.getElementById('foodGuideBtn').onclick = function(){
    var g = document.getElementById('foodGuide');
    g.style.display = g.style.display === 'none' ? 'block' : 'none';
  };
  function logEvent(text, type){
    events.push({t: simT, text: text, type: type || 'info'});
    if (events.length > 3000) events.shift(); // full-game history for play-by-play
    var ticker = document.getElementById('ticker');
    if (ticker){
      var tm = Math.floor(simT);
      var ts = Math.floor(tm/60) + ':' + String(tm%60).padStart(2,'0');
      var div = document.createElement('div');
      var html = '[' + ts + '] ' + text;
      // color colony names
      for (var cci = 0; cci < COLONIES.length; cci++){
        var cname = COLONIES[cci].name;
        var ccol = COLONIES[cci].color;
        html = html.split(cname).join('<span style="color:' + ccol + ';font-weight:bold;">' + cname + '</span>');
      }
      div.innerHTML = html;
      div.style.color = EVENT_COLORS[type] || EVENT_COLORS.info;
      ticker.appendChild(div);
      while (ticker.children.length > 50) ticker.removeChild(ticker.firstChild);
      ticker.scrollTop = ticker.scrollHeight;
    }
  }

  function recordKill(a, cause){
    var ci = a.warrior ? 2 : (a.forager ? 1 : 0);
    kills[a.col][ci]++;
    if (cause && predKills[cause]) predKills[cause][a.col]++;
  }

  function makeAnt(c, i){
    var n = nestPos(c);
    var a = Math.random()*Math.PI*2;
    var isWarrior, isForager;
    if (i === undefined){
      var r = Math.random();
      isWarrior = r < 0.05;
      isForager = !isWarrior && r < 0.25;
    } else {
      isWarrior = (i % 20 === 0);
      isForager = !isWarrior && (i % 5 === 1);
      if (isWarrior){
        var wn = i / 20;
        a = wn * (Math.PI*2/17) + (Math.random()-0.5)*0.6;
      }
    }
    return {
      col: c,
      x: n.x + (Math.random()-0.5)*30,
      y: n.y + (Math.random()-0.5)*30,
      angle: a,
      speed: isWarrior ? 0.7 + Math.random()*0.35 : (isForager ? 1.2 + Math.random()*0.6 : 0.6 + Math.random()*0.3),
      state: 0,
      carrying: false,
      forager: isForager,
      warrior: isWarrior,
      huntT: null, huntCd: 0,
      onTrail: false,
      tx: undefined, ty: undefined,
      fighting: null, combatT: 0,
      trapped: 0, carryValue: 0,
      flier: !isWarrior && !isForager && Math.random() < 0.025,
      flying: false, flierWander: false, webAnnounced: false, escapeAnnounced: false
    };
  }

  function spawnAnts(){
    ants = [];
    for (var c = 0; c < 3; c++){
      totalSpawned[c] = ANTS_PER;
      for (var i = 0; i < ANTS_PER; i++){
        ants.push(makeAnt(c, i));
      }
    }
  }

  function pherAt(col, x, y){
    var gx = Math.max(0, Math.min(GW-1, (x/W*GW)|0));
    var gy = Math.max(0, Math.min(GH-1, (y/H*GH)|0));
    return pher[col][gy*GW+gx];
  }

  function depositPher(col, x, y, amt){
    var gx = Math.max(0, Math.min(GW-1, (x/W*GW)|0));
    var gy = Math.max(0, Math.min(GH-1, (y/H*GH)|0));
    var i = gy*GW+gx;
    pher[col][i] = Math.min(255, pher[col][i] + amt);
  }

  function evaporate(){
    for (var c = 0; c < 3; c++){
      var p = pher[c];
      for (var i = 0; i < p.length; i++){
        p[i] *= 0.997;
        if (p[i] < 0.5) p[i] = 0;
      }
    }
  }

  function simStep(){
    // evaporate every few steps for perf
    if ((frameCount % 3) === 0) evaporate();

    for (var i = 0; i < ants.length; i++){
      var a = ants[i];
      var n = nestPos(a.col);
      // FLIER: fly to target or home at 2x, ignoring terrain
      // idle fliers pick distant targets to stay airborne
      if (a.flier && !a.warrior && !a.forager && !a.carrying && a.tx === undefined && a.state === 0){
        var fang = Math.random()*Math.PI*2;
        var fdist0 = 150 + Math.random()*250;
        a.tx = Math.max(20, Math.min(W-20, a.x + Math.cos(fang)*fdist0));
        a.ty = Math.max(20, Math.min(H-20, a.y + Math.sin(fang)*fdist0));
        a.flierWander = true;
      }
      if (a.flier && !a.warrior && !a.forager && (a.tx !== undefined || a.carrying)){
        var ftx = a.carrying ? n.x : a.tx;
        var fty = a.carrying ? n.y : a.ty;
        var fdx = ftx-a.x, fdy = fty-a.y;
        var fdist = Math.sqrt(fdx*fdx+fdy*fdy);
        if (fdist < 14){
          a.flying = false;
          if (!a.carrying){ a.tx = undefined; a.ty = undefined; a.flierWander = false; }
          // carrying: normal delivery logic runs next frame
        } else {
          a.flying = true;
          a.angle = Math.atan2(fdy, fdx);
          a.x += Math.cos(a.angle)*a.speed*2;
          a.y += Math.sin(a.angle)*a.speed*2;
          if (a.x < 2) a.x = 2; if (a.x > W-2) a.x = W-2;
          if (a.y < 2) a.y = 2; if (a.y > H-2) a.y = H-2;
          continue; // skip ground logic (webs, combat, slowdown)
        }
      } else {
        a.flying = false;
      }
      // TRAPPED in web: struggle, countdown
      if (a.trapped > 0){
        a.trapped--;
        a.x += (Math.random()-0.5)*2;
        a.y += (Math.random()-0.5)*2;
        if (a.trapped === 0) a.escapedWeb = true;
        continue;
      }
      // check web entry
      for (var wbi = 0; wbi < obstacles.length; wbi++){
        var wob = obstacles[wbi];
        if (wob.type !== 'web') continue;
        var wdx = a.x-wob.x, wdy = a.y-wob.y;
        if (wdx*wdx+wdy*wdy < wob.r*wob.r*0.64){
          a.trapped = 150 + (Math.random()*90|0); // 2.5-4 sec
          break;
        }
      }
      if (a.trapped > 0) continue;
      // WARRIOR: separation from packmates outside base
      if (a.warrior){
        var bdx = n.x-a.x, bdy = n.y-a.y;
        var bdist = Math.sqrt(bdx*bdx+bdy*bdy);
        if (bdist > 40){
          for (var si = 0; si < ants.length; si++){
            var sa = ants[si];
            if (sa === a || !sa.warrior || sa.col !== a.col) continue;
            var sdx = a.x-sa.x, sdy = a.y-sa.y;
            var sdl = sdx*sdx+sdy*sdy;
            if (sdl < 400 && sdl > 0.01){
              var sd = Math.sqrt(sdl);
              var push = (20-sd)*0.6;
              a.x += (sdx/sd)*push;
              a.y += (sdy/sd)*push;
            }
          }
        }
      }
      // WARRIOR: hunt enemy ants
      if (a.warrior && !a.fighting){
        // refresh target periodically or if dead/gone
        if (!a.huntT || a.huntT.dead || --a.huntCd <= 0){
          a.huntT = null;
          var bestD = 1e12;
          // nearest enemy (sample for perf)
          for (var hi = 0; hi < ants.length; hi += 3){
            var ha2 = ants[hi];
            if (ha2.col === a.col || ha2.dead || ha2 === a || ha2.trapped > 0 || ha2.flying) continue;
            var hdx = ha2.x-a.x, hdy = ha2.y-a.y;
            var hd = hdx*hdx+hdy*hdy;
            if (hd < bestD){ bestD = hd; a.huntT = ha2; }
          }
          a.huntCd = 30;
        }
        if (a.huntT && !a.huntT.dead){
          var tdx = a.huntT.x-a.x, tdy = a.huntT.y-a.y;
          var tdl = Math.sqrt(tdx*tdx+tdy*tdy) || 1;
          var ta = Math.atan2(tdy, tdx);
          var tad = ta - a.angle;
          while (tad > Math.PI) tad -= Math.PI*2;
          while (tad < -Math.PI) tad += Math.PI*2;
          a.angle += Math.max(-0.4, Math.min(0.4, tad));
          var hwsp = terrainSpeed(a.x, a.y);
          a.x += Math.cos(a.angle)*a.speed*hwsp;
          a.y += Math.sin(a.angle)*a.speed*hwsp;
          if (hwsp === 0.2) pushLeaf(a.x, a.y, Math.cos(a.angle)*a.speed*hwsp, Math.sin(a.angle)*a.speed*hwsp);
          collideObstacles(a);
          // instant kill on contact (non-warriors only)
          if (tdl < 10 && !a.huntT.warrior && a.huntT.trapped <= 0){
            if (a.huntT.flier){
              logEvent('A ' + COLONIES[a.col].name + ' warrior brought down a ' + COLONIES[a.huntT.col].name + ' flying ant', 'attack');
            }
            recordKill(a.huntT, 'warrior');
            a.huntT.dead = true;
            battles.push({x: a.huntT.x, y: a.huntT.y, t: 0});
            a.huntT = null;
          }
          continue;
        }
      }
      // GRAPPLE: locked in combat, drawn to opponent
      if (a.fighting){
        var foe = a.fighting;
        if (!foe || foe.dead){
          a.fighting = null; a.combatT = 0;
        } else {
          var fdx = foe.x-a.x, fdy = foe.y-a.y;
          var fa = Math.atan2(fdy, fdx);
          var fad = fa - a.angle;
          while (fad > Math.PI) fad -= Math.PI*2;
          while (fad < -Math.PI) fad += Math.PI*2;
          a.angle += Math.max(-0.5, Math.min(0.5, fad));
          var fwsp = terrainSpeed(a.x, a.y);
          a.x += Math.cos(a.angle)*a.speed*1.3*fwsp;
          a.y += Math.sin(a.angle)*a.speed*1.3*fwsp;
          if (fwsp === 0.2) pushLeaf(a.x, a.y, Math.cos(a.angle)*a.speed*1.3*fwsp, Math.sin(a.angle)*a.speed*1.3*fwsp);
          collideObstacles(a);
          a.combatT++;
          a.x += (Math.random()-0.5)*1.5;
          a.y += (Math.random()-0.5)*1.5;
          if (a.combatT > 40){
            var loser = Math.random() < 0.5 ? a : foe;
            var combatWinner = loser === a ? foe : a;
            recordKill(loser, 'combat');
            loser.dead = true;
            combatWinner.fighting = null; combatWinner.combatT = 0;
            battles.push({x: (a.x+foe.x)/2, y: (a.y+foe.y)/2, t: 0});
          }
          continue;
        }
      }

      if (a.state === 0){
        // prune depleted discoveries (for deployment targeting)
        if (!a.forager && !a.warrior){
          var ffl = foundFood[a.col];
          for (var pli = ffl.length-1; pli >= 0; pli--){
            var alive = false;
            for (var fl2 = 0; fl2 < foods.length; fl2++){
              var fdx = foods[fl2].x-ffl[pli].x, fdy = foods[fl2].y-ffl[pli].y;
              if (fdx*fdx+fdy*fdy < 900 && foods[fl2].amount > 0){ alive = true; break; }
            }
            if (!alive) ffl.splice(pli, 1);
          }
        }
        // targeted deployment: steer to assigned food
        if (!a.forager && a.tx !== undefined){
          var tdx2 = a.tx-a.x, tdy2 = a.ty-a.y;
          var tdl = Math.sqrt(tdx2*tdx2+tdy2*tdy2) || 1;
          // verify target still has food
          var tAlive = false;
          for (var ta2 = 0; ta2 < foods.length; ta2++){
            var ftdx = foods[ta2].x-a.tx, ftdy = foods[ta2].y-a.ty;
            if (ftdx*ftdx+ftdy*ftdy < 900 && foods[ta2].amount > 0){ tAlive = true; break; }
          }
          if (!tAlive || tdl < 12){
            a.tx = undefined; a.ty = undefined;
          } else {
            var tta = Math.atan2(tdy2, tdx2);
            var tad = tta - a.angle;
            while (tad > Math.PI) tad -= Math.PI*2;
            while (tad < -Math.PI) tad += Math.PI*2;
            a.angle += Math.max(-0.3, Math.min(0.3, tad));
            var twsp = terrainSpeed(a.x, a.y);
            a.x += Math.cos(a.angle)*a.speed*twsp;
            a.y += Math.sin(a.angle)*a.speed*twsp;
            if (twsp === 0.2) pushLeaf(a.x, a.y, Math.cos(a.angle)*a.speed*twsp, Math.sin(a.angle)*a.speed*twsp);
            collideObstacles(a);
            if (a.x < 2){ a.x = 2; a.angle = Math.PI - a.angle; }
            if (a.x > W-2){ a.x = W-2; a.angle = Math.PI - a.angle; }
            if (a.y < 2){ a.y = 2; a.angle = -a.angle; }
            if (a.y > H-2){ a.y = H-2; a.angle = -a.angle; }
            // food pickup (same as below)
            for (var tf = 0; tf < foods.length; tf++){
              var tfd = foods[tf];
              if (tfd.amount <= 0) continue;
              var tdx3 = a.x-tfd.x, tdy3 = a.y-tfd.y;
              if (tdx3*tdx3+tdy3*tdy3 < 100){
                tfd.amount--;
                a.carrying = true;
                a.state = 1;
                a.tx = undefined; a.ty = undefined;
                a.angle += Math.PI;
                if (!layCurvedTrail(a.col, tfd.x, tfd.y)){
                  var tnn = nestPos(a.col);
                  var ttdx = tnn.x-tfd.x, ttdy = tnn.y-tfd.y;
                  var ttlen = Math.sqrt(ttdx*ttdx+ttdy*ttdy) || 1;
                  var tsteps = Math.ceil(ttlen/4);
                  for (var tts = 0; tts <= tsteps; tts++){
                    depositPher(a.col, tfd.x+ttdx*tts/tsteps, tfd.y+ttdy*tts/tsteps, 14);
                  }
                }
                break;
              }
            }
            continue;
          }
        }
        // SEARCH: workers follow pheromones, foragers wander free
        var sd = 14, sa = 0.6;
        var cxp = a.x + Math.cos(a.angle)*sd, cyp = a.y + Math.sin(a.angle)*sd;
        var lxp = a.x + Math.cos(a.angle-sa)*sd, lyp = a.y + Math.sin(a.angle-sa)*sd;
        var rxp = a.x + Math.cos(a.angle+sa)*sd, ryp = a.y + Math.sin(a.angle+sa)*sd;
        if (!a.forager && !a.warrior){
          var cp = pherAt(a.col, cxp, cyp);
          var lp = pherAt(a.col, lxp, lyp);
          var rp = pherAt(a.col, rxp, ryp);
          var mxp = Math.max(cp, lp, rp);
          if (mxp > 3){
            a.onTrail = true;
            if (cp >= lp && cp >= rp){ /* straight */ }
            else if (lp > rp) a.angle -= 0.3;
            else a.angle += 0.3;
          } else {
            a.onTrail = false;
          }
          // trail died: head home briefly
          if (a.onTrail && mxp < 1){
            var tdx = n.x-a.x, tdy = n.y-a.y;
            a.angle = Math.atan2(tdy, tdx);
          }
          a.angle += (Math.random()-0.5)*0.5;
        } else if (a.forager){
          a.angle += (Math.random()-0.5)*0.8;
        }

        var wsp = terrainSpeed(a.x, a.y);
        a.x += Math.cos(a.angle)*a.speed*wsp;
        a.y += Math.sin(a.angle)*a.speed*wsp;
        // ants shove leaves opposite their travel
        if (wsp === 0.2) pushLeaf(a.x, a.y, Math.cos(a.angle)*a.speed*wsp, Math.sin(a.angle)*a.speed*wsp);
        collideObstacles(a);

        // wall bounce
        if (a.x < 2){ a.x = 2; a.angle = Math.PI - a.angle; }
        if (a.x > W-2){ a.x = W-2; a.angle = Math.PI - a.angle; }
        if (a.y < 2){ a.y = 2; a.angle = -a.angle; }
        if (a.y > H-2){ a.y = H-2; a.angle = -a.angle; }

        // food pickup (radius scales with food size)
        for (var f = 0; f < foods.length; f++){
          var fd = foods[f];
          if (fd.amount <= 0) continue;
          var pr = fd.size || (fd.type === 'seed' ? 14 : (fd.type === 'fungus' ? 18 : 10));
          var dx = a.x-fd.x, dy = a.y-fd.y;
          if (dx*dx+dy*dy < pr*pr){
            if (a.forager){
              // scout: mark trail, keep hunting
              layCurvedTrail(a.col, fd.x, fd.y);
              var ff = foundFood[a.col], known = false;
              for (var ki = 0; ki < ff.length; ki++){
                var kdx = ff[ki].x-fd.x, kdy = ff[ki].y-fd.y;
                if (kdx*kdx+kdy*kdy < 900){ known = true; break; }
              }
              if (!known){
                ff.push({x: fd.x, y: fd.y});
                // deploy a random number of workers to this source
                var idle = [];
                for (var wi = 0; wi < ants.length; wi++){
                  var wa = ants[wi];
                  if (wa.col === a.col && !wa.forager && wa.state === 0 &&
                      !wa.carrying && wa.tx === undefined) idle.push(wa);
                }
                // shuffle
                for (var sh = idle.length-1; sh > 0; sh--){
                  var sj = (Math.random()*(sh+1))|0;
                  var tmp = idle[sh]; idle[sh] = idle[sj]; idle[sj] = tmp;
                }
                var deployN = Math.max(1, Math.floor(idle.length * (0.15 + Math.random()*0.6)));
                for (var di = 0; di < deployN && di < idle.length; di++){
                  idle[di].tx = fd.x; idle[di].ty = fd.y;
                }
              }
              a.angle += Math.PI*0.7;
              break;
            }
            fd.amount--;
            a.carrying = true;
            a.carryValue = fd.value || 1;
            a.state = 1;
            a.angle += Math.PI; // turn around
            // pheromone trail curves around obstacles
            if (!layCurvedTrail(a.col, fd.x, fd.y)){
              var nn = nestPos(a.col);
              var tdx = nn.x-fd.x, tdy = nn.y-fd.y;
              var tlen = Math.sqrt(tdx*tdx+tdy*tdy) || 1;
              var steps = Math.ceil(tlen/4);
              for (var ts = 0; ts <= steps; ts++){
                depositPher(a.col, fd.x+tdx*ts/steps, fd.y+tdy*ts/steps, 14);
              }
            }
            break;
          }
        }
      } else {
        // RETURN: head to nest, lay pheromone
        var ndx = n.x - a.x, ndy = n.y - a.y;
        var ndl = Math.sqrt(ndx*ndx+ndy*ndy) || 1;
        var targetA = Math.atan2(ndy, ndx);
        var da = targetA - a.angle;
        while (da > Math.PI) da -= Math.PI*2;
        while (da < -Math.PI) da += Math.PI*2;
        a.angle += da * 0.3 + (Math.random()-0.5)*0.2;

        var wsp2 = terrainSpeed(a.x, a.y);
        a.x += Math.cos(a.angle)*a.speed*1.1*wsp2;
        a.y += Math.sin(a.angle)*a.speed*1.1*wsp2;
        if (wsp2 === 0.2) pushLeaf(a.x, a.y, Math.cos(a.angle)*a.speed*1.1*wsp2, Math.sin(a.angle)*a.speed*1.1*wsp2);
        collideObstacles(a);

        if (ndl < 18){
          banked[a.col] += a.carryValue || 1;
          a.carrying = false;
          a.carryValue = 0;
          a.state = 0;
          a.angle = Math.random()*Math.PI*2;
          // countdown: announce each delivery from 485 to win
          if (banked[a.col] >= 485 && banked[a.col] < WIN_FOOD){
            var toGo = WIN_FOOD - banked[a.col];
            logEvent(COLONIES[a.col].name + ': ' + toGo + ' food to go', 'milestone');
          }
          if (banked[a.col] >= WIN_FOOD && winner < 0){
            winner = a.col;
            showVictory();
            var msg = COLONIES[a.col].name + ' colony wins with ' + WIN_FOOD + ' food!';
            if (bet === a.col) msg += ' YOUR BET WON!';
            else if (bet >= 0) msg += ' Your bet on ' + COLONIES[bet].name + ' lost.';
            statusEl.textContent = msg;
          }
        }
      }
    }

    // remove depleted food, spawn replacements
    for (var fi = foods.length-1; fi >= 0; fi--){
      if (foods[fi].amount <= 0) foods.splice(fi, 1);
    }
    var sugarN = 0, seedN = 0;
    for (var fc = 0; fc < foods.length; fc++){
      if (foods[fc].type === 'sugar') sugarN++;
      else if (foods[fc].type === 'seed') seedN++;
    }
    while (sugarN < 6){ spawnFoodCluster(); sugarN++; }
    while (seedN < 8){ spawnSeed(); seedN++; }

    // assassin bug: every 30 sec wanders across
    if ((frameCount % 1800) === 0 && !assassin && started){
      var edge = (Math.random()*4)|0;
      var ax, ay, aa;
      if (edge === 0){ ax = -20; ay = Math.random()*H; aa = 0; }
      else if (edge === 1){ ax = W+20; ay = Math.random()*H; aa = Math.PI; }
      else if (edge === 2){ ax = Math.random()*W; ay = -20; aa = Math.PI/2; }
      else { ax = Math.random()*W; ay = H+20; aa = -Math.PI/2; }
      assassin = {x: ax, y: ay, angle: aa, speed: 1.1, victims: [], trapped: 0};
      logEvent('Assassin bug on the prowl', 'assassin');
    }
    if (assassin){
      // web trap
      if (assassin.trapped > 0){
        assassin.trapped--;
        assassin.x += (Math.random()-0.5)*1.5;
        assassin.y += (Math.random()-0.5)*1.5;
      }
      // slowed 40% in webs (not trapped)
      var abInWeb = false;
      for (var abw = 0; abw < obstacles.length; abw++){
        var abob = obstacles[abw];
        if (abob.type !== 'web') continue;
        var abdx = assassin.x-abob.x, abdy = assassin.y-abob.y;
        if (abdx*abdx+abdy*abdy < abob.r*abob.r*0.64){ abInWeb = true; break; }
      }
      // wander with purpose
      assassin.angle += (Math.random()-0.5)*0.3;
      var abSpd = assassin.speed * (abInWeb ? 0.6 : 1);
      assassin.x += Math.cos(assassin.angle)*abSpd;
      assassin.y += Math.sin(assassin.angle)*abSpd;
      // snatch ants onto its back
      for (var ai2 = 0; ai2 < ants.length; ai2++){
        var prey = ants[ai2];
        if (prey.dead) continue;
        var pdx = prey.x-assassin.x, pdy = prey.y-assassin.y;
        if (pdx*pdx+pdy*pdy < 144){
          recordKill(prey, 'assassin');
          prey.dead = true;
          assassin.victims.push(prey.col);
          if (prey.flier){
            logEvent('Assassin bug snatched a ' + COLONIES[prey.col].name + ' flying ant from the sky', 'assassin');
          } else {
            logEvent('Assassin bug devoured a ' + COLONIES[prey.col].name + ' ant', 'assassin');
          }
          assassin.lastVictimCol = prey.col;
          battles.push({x: prey.x, y: prey.y, t: 0});
          break; // one per frame
        }
      }
      // only leaves with at least 10 victims; otherwise turns back
      if (assassin.x < -20 || assassin.x > W+20 || assassin.y < -20 || assassin.y > H+20){
        if (assassin.victims.length >= 10){
          assassin = null;
        } else {
          // turn back into the arena
          assassin.angle += Math.PI;
          assassin.x = Math.max(0, Math.min(W, assassin.x));
          assassin.y = Math.max(0, Math.min(H, assassin.y));
        }
      }
    }
    // spider: every 60 sec raids nearest web, then leaves
    if ((frameCount % 3600) === 0 && !spider && started){
      var webs = [];
      for (var wbi2 = 0; wbi2 < obstacles.length; wbi2++){
        if (obstacles[wbi2].type === 'web') webs.push(obstacles[wbi2]);
      }
      if (webs.length > 0){
        var edge = (Math.random()*4)|0;
        var sx2, sy2;
        if (edge === 0){ sx2 = -30; sy2 = Math.random()*H; }
        else if (edge === 1){ sx2 = W+30; sy2 = Math.random()*H; }
        else if (edge === 2){ sx2 = Math.random()*W; sy2 = -30; }
        else { sx2 = Math.random()*W; sy2 = H+30; }
        // nearest web to entry
        var nw = webs[0], nd = 1e12;
        for (var nwi = 0; nwi < webs.length; nwi++){
          var wdx = webs[nwi].x-sx2, wdy = webs[nwi].y-sy2;
          var wd = wdx*wdx+wdy*wdy;
          if (wd < nd){ nd = wd; nw = webs[nwi]; }
        }
        spider = {x: sx2, y: sy2, angle: 0, speed: 1.6,
                  state: 'hunt', web: nw, ex: sx2, ey: sy2};
        logEvent('Spider incoming!', 'spider');
      }
    }
    if (spider){
      var tgt;
      if (spider.state === 'hunt'){
        tgt = {x: spider.web.x, y: spider.web.y};
        var sdx = tgt.x-spider.x, sdy = tgt.y-spider.y;
        var sdl = Math.sqrt(sdx*sdx+sdy*sdy);
        if (sdl < spider.web.r*0.5){
          // consume all trapped ants in this web
          var eatenByCol = [0,0,0];
          for (var eai = 0; eai < ants.length; eai++){
            var ea = ants[eai];
            if (ea.dead || ea.trapped <= 0) continue;
            var edx = ea.x-spider.web.x, edy = ea.y-spider.web.y;
            if (edx*edx+edy*edy < spider.web.r*spider.web.r){
              recordKill(ea, 'spider');
              ea.dead = true;
              eatenByCol[ea.col]++;
              battles.push({x: ea.x, y: ea.y, t: 0});
            }
          }
          // (assassin no longer gets trapped, so spider can't catch it)
          for (var ecb = 0; ecb < 3; ecb++){
            if (eatenByCol[ecb] > 0){
              logEvent('Spider took ' + eatenByCol[ecb] + ' ' + COLONIES[ecb].name + ' ants from a web', 'spider');
            }
          }
          spider.state = 'leave';
        }
      } else {
        tgt = {x: spider.ex, y: spider.ey};
      }
      var tx2 = tgt.x-spider.x, ty2 = tgt.y-spider.y;
      var ta2 = Math.atan2(ty2, tx2);
      var tad2 = ta2 - spider.angle;
      while (tad2 > Math.PI) tad2 -= Math.PI*2;
      while (tad2 < -Math.PI) tad2 += Math.PI*2;
      spider.angle += Math.max(-0.15, Math.min(0.15, tad2));
      spider.x += Math.cos(spider.angle)*spider.speed;
      spider.y += Math.sin(spider.angle)*spider.speed;
      if (spider.state === 'leave'){
        var ldx = spider.ex-spider.x, ldy = spider.ey-spider.y;
        if (ldx*ldx+ldy*ldy < 2500) spider = null;
      }
    }
    // respawn depleted colonies: 3/sec, no cap (random castes)
    var counts = [0, 0, 0];
    for (var ci = 0; ci < ants.length; ci++) counts[ants[ci].col]++;
    for (var rc = 0; rc < 3; rc++){
      if (counts[rc] <= ANTS_PER * 0.1 && !respawning[rc]){
        respawning[rc] = true;
        logEvent(COLONIES[rc].name + ' colony rebuilding (' + counts[rc] + ' ants left)', 'respawn');
      }
      if (respawning[rc] && (frameCount % 60) === 0){
        for (var rs = 0; rs < 3; rs++){
          ants.push(makeAnt(rc)); // random role via makeAnt
          counts[rc]++;
          totalSpawned[rc]++;
        }
      }
    }

    for (var acd = 0; acd < 3; acd++) if (attackCooldown[acd] > 0) attackCooldown[acd]--;
    // track army size extremes + food history
    for (var tc = 0; tc < 3; tc++){
      if (counts[tc] > peakAnts[tc]) peakAnts[tc] = counts[tc];
      if (counts[tc] < minAnts[tc]) minAnts[tc] = counts[tc];
    }
    if ((frameCount % 300) === 0){
      for (var fh = 0; fh < 3; fh++) foodHist[fh].push(banked[fh]);
    }
    // web trap clusters: announce when 5+ unannounced ants of a colony trapped
    var trappedUnann = [[], [], []];
    for (var tci = 0; tci < ants.length; tci++){
      var ta = ants[tci];
      if (ta.trapped > 0 && !ta.webAnnounced) trappedUnann[ta.col].push(ta);
    }
    for (var tcc = 0; tcc < 3; tcc++){
      if (trappedUnann[tcc].length >= 5){
        for (var tmi = 0; tmi < trappedUnann[tcc].length; tmi++){
          trappedUnann[tcc][tmi].webAnnounced = true;
        }
        logEvent(trappedUnann[tcc].length + ' ' + COLONIES[tcc].name + ' ants tangled in webs', 'spider');
      }
    }
    // web escape clusters: 5+ unannounced escapes per colony
    var escapedUnann = [[], [], []];
    for (var eci = 0; eci < ants.length; eci++){
      var ea = ants[eci];
      if (ea.escapedWeb && !ea.escapeAnnounced) escapedUnann[ea.col].push(ea);
    }
    for (var ecc = 0; ecc < 3; ecc++){
      if (escapedUnann[ecc].length >= 5){
        for (var emi = 0; emi < escapedUnann[ecc].length; emi++){
          escapedUnann[ecc][emi].escapeAnnounced = true;
          escapedUnann[ecc][emi].escapedWeb = false;
        }
        logEvent(escapedUnann[ecc].length + ' ' + COLONIES[ecc].name + ' ants escaped from webs', 'spider');
      }
    }
    // gust of wind every 30 sec: blows leaves (animated)
    if (started && frameCount % 1800 === 0 && frameCount > 0){
      var wang = Math.random()*Math.PI*2;
      var wdist = 60 + Math.random()*80;
      var wdx = Math.cos(wang)*wdist, wdy = Math.sin(wang)*wdist;
      var wlines = [];
      for (var wli2 = 0; wli2 < 45; wli2++){
        wlines.push({x: Math.random()*W, y: Math.random()*H,
                     len: 35+Math.random()*45, spd: 7+Math.random()*6});
      }
      windAnim = {angle: wang, t: 0, dur: 90, lines: wlines, dx: wdx, dy: wdy};
      for (var wli = 0; wli < obstacles.length; wli++){
        var wob = obstacles[wli];
        if (wob.type !== 'leaf') continue;
        wob.wx0 = wob.x; wob.wy0 = wob.y;
        wob.wx1 = Math.max(20, Math.min(W-20, wob.x + wdx));
        wob.wy1 = Math.max(20, Math.min(H-20, wob.y + wdy));
      }
      logEvent('Gust of wind blows the leaves', 'wind');
    }
    // animate wind + leaves
    if (windAnim){
      windAnim.t++;
      var wp = Math.min(1, windAnim.t / windAnim.dur);
      var we = 1 - Math.pow(1-wp, 2); // ease-out
      for (var wai = 0; wai < obstacles.length; wai++){
        var wao = obstacles[wai];
        if (wao.type !== 'leaf' || wao.wx0 === undefined) continue;
        wao.x = wao.wx0 + (wao.wx1-wao.wx0)*we;
        wao.y = wao.wy0 + (wao.wy1-wao.wy0)*we;
      }
      if (windAnim.t >= windAnim.dur) windAnim = null;
    }
    // food milestones: 100, 200, 300, 400
    for (var ms = 0; ms < 3; ms++){
      var msteps = [100, 200, 300, 400];
      for (var mi = 0; mi < msteps.length; mi++){
        if (!milestones[ms][msteps[mi]] && banked[ms] >= msteps[mi]){
          milestones[ms][msteps[mi]] = true;
          logEvent(COLONIES[ms].name + ' reached ' + msteps[mi] + ' food', 'milestone');
        }
      }
    }
    // pair up combatants within 15px (grapple until one dies)
    // warriors only fight warriors; others can't touch them
    for (var bi = 0; bi < ants.length; bi++){
      var ba = ants[bi];
      if (ba.dead || ba.fighting || ba.trapped > 0 || ba.flying) continue;
      for (var bj = bi+1; bj < ants.length; bj++){
        var bb = ants[bj];
        if (bb.col === ba.col || bb.dead || bb.fighting || bb.trapped > 0) continue;
        if (ba.warrior !== bb.warrior) continue;
        var bdx = ba.x-bb.x, bdy = ba.y-bb.y;
        if (bdx*bdx+bdy*bdy < 225){
          ba.fighting = bb; bb.fighting = ba;
          ba.combatT = 0; bb.combatT = 0;
          // under attack event (throttled)
          if (attackCooldown[bb.col] <= 0){
            logEvent(COLONIES[bb.col].name + ' colony under attack by ' + COLONIES[ba.col].name, 'attack');
            attackCooldown[bb.col] = 1800;
          }
          if (attackCooldown[ba.col] <= 0){
            logEvent(COLONIES[ba.col].name + ' colony under attack by ' + COLONIES[bb.col].name, 'attack');
            attackCooldown[ba.col] = 1800;
          }
          break;
        }
      }
    }
    var anyDead = false;
    for (var di2 = 0; di2 < ants.length; di2++) if (ants[di2].dead){ anyDead = true; break; }
    if (anyDead) ants = ants.filter(function(x){ return !x.dead; });
    // age battle flashes
    for (var bti = battles.length-1; bti >= 0; bti--){
      battles[bti].t++;
      if (battles[bti].t > 30) battles.splice(bti, 1);
    }
  }

  function render(){
    // soil background
    ctx.drawImage(soilCanvas, 0, 0);

    // obstacles
    for (var oi = 0; oi < obstacles.length; oi++){
      var ob = obstacles[oi];
      if (ob.type === 'rock'){
        var nv2 = ob.verts.length;
        // vertex positions
        var vxp = [], vyp = [];
        for (var vi2 = 0; vi2 < nv2; vi2++){
          var va2 = vi2/nv2*Math.PI*2;
          var vr2 = ob.r*ob.verts[vi2];
          vxp.push(ob.x+Math.cos(va2)*vr2);
          vyp.push(ob.y+Math.sin(va2)*vr2*0.88);
        }
        // extruded 3D sides (rock has height)
        var lift = ob.r*0.28;
        for (var sdi = 0; sdi < nv2; sdi++){
          var nsi = (sdi+1)%nv2;
          // only draw sides facing down/right (light from top-left)
          var mx = (vxp[sdi]+vxp[nsi])/2 - ob.x;
          var my = (vyp[sdi]+vyp[nsi])/2 - ob.y;
          if (mx*0.5+my*0.85 < 0) continue; // back faces skip
          var dark2 = 0.45 + 0.25*((mx*0.5+my*0.85)/(ob.r*1.2));
          var sr = Math.round(70*dark2), sg2 = Math.round(68*dark2), sb2 = Math.round(64*dark2);
          ctx.fillStyle = 'rgb('+sr+','+sg2+','+sb2+')';
          ctx.beginPath();
          ctx.moveTo(vxp[sdi], vyp[sdi]);
          ctx.lineTo(vxp[nsi], vyp[nsi]);
          ctx.lineTo(vxp[nsi]+3, vyp[nsi]+lift);
          ctx.lineTo(vxp[sdi]+3, vyp[sdi]+lift);
          ctx.closePath();
          ctx.fill();
        }
        // ground shadow
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.ellipse(ob.x+4, ob.y+ob.r*0.6+lift*0.5, ob.r*1.0, ob.r*0.38, 0, 0, Math.PI*2);
        ctx.fill();
        // ambient occlusion at base
        var ao = ctx.createRadialGradient(ob.x, ob.y, ob.r*0.5, ob.x, ob.y, ob.r*1.15);
        ao.addColorStop(0, 'rgba(0,0,0,0)');
        ao.addColorStop(1, 'rgba(0,0,0,0.35)');
        ctx.fillStyle = ao;
        ctx.beginPath();
        for (var aoi = 0; aoi < nv2; aoi++){
          if (aoi === 0) ctx.moveTo(vxp[aoi], vyp[aoi]);
          else ctx.lineTo(vxp[aoi], vyp[aoi]);
        }
        ctx.closePath(); ctx.fill();
        // faceted body: triangles from centroid, each own shade
        for (var f2 = 0; f2 < nv2; f2++){
          var n2 = (f2+1)%nv2;
          var sh = ob.shades[f2];
          var br = Math.round(92*sh), bg = Math.round(90*sh), bb = Math.round(86*sh);
          ctx.fillStyle = 'rgb('+br+','+bg+','+bb+')';
          ctx.beginPath();
          ctx.moveTo(ob.x, ob.y);
          ctx.lineTo(vxp[f2], vyp[f2]);
          ctx.lineTo(vxp[n2], vyp[n2]);
          ctx.closePath();
          ctx.fill();
        }
        // facet edge lines
        ctx.strokeStyle = 'rgba(0,0,0,0.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var e2 = 0; e2 <= nv2; e2++){
          var ei = e2%nv2;
          if (e2 === 0) ctx.moveTo(vxp[ei], vyp[ei]);
          else ctx.lineTo(vxp[ei], vyp[ei]);
        }
        ctx.stroke();
        // cracks
        ctx.strokeStyle = 'rgba(20,20,18,0.55)';
        ctx.lineWidth = 1.2;
        for (var cr2 = 0; cr2 < ob.cracks.length; cr2++){
          var cr = ob.cracks[cr2];
          ctx.beginPath();
          ctx.moveTo(ob.x+Math.cos(cr.a)*ob.r*0.85, ob.y+Math.sin(cr.a)*ob.r*0.75);
          ctx.lineTo(ob.x+Math.cos(cr.a)*ob.r*(0.85-cr.len), ob.y+Math.sin(cr.a)*ob.r*(0.75-cr.len*0.85));
          ctx.stroke();
        }
        // top-left facet highlight (light source)
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.beginPath();
        ctx.moveTo(ob.x, ob.y);
        ctx.lineTo(vxp[4%nv2], vyp[4%nv2]);
        ctx.lineTo(vxp[5%nv2], vyp[5%nv2]);
        ctx.closePath();
        ctx.fill();
      } else if (ob.type === 'twig'){
        var cdx = Math.cos(ob.ang), cdy = Math.sin(ob.ang);
        var px2 = -cdy, py2 = cdx;
        var hl = ob.len/2, hw = ob.wid/2;
        ctx.save();
        ctx.translate(ob.x, ob.y);
        ctx.rotate(ob.ang);
        // shadow
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(3, 5, hl, hw+2, 0, 0, Math.PI*2);
        ctx.fill();
        // body: tapered (draw as trapezoid)
        var g2 = ctx.createLinearGradient(0, -hw, 0, hw);
        g2.addColorStop(0, '#7a5a36');
        g2.addColorStop(0.5, '#5e4426');
        g2.addColorStop(1, '#3e2c16');
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.moveTo(-hl, -hw*0.55);
        ctx.lineTo(hl, -hw*0.8);
        ctx.lineTo(hl, hw*0.8);
        ctx.lineTo(-hl, hw*0.55);
        ctx.closePath();
        ctx.fill();
        // bark stripes (longitudinal)
        for (var bki = 0; bki < ob.bark.length; bki++){
          var bk2 = ob.bark[bki];
          var br2 = Math.round(90*bk2.tone), bg2 = Math.round(66*bk2.tone), bb2 = Math.round(38*bk2.tone);
          ctx.strokeStyle = 'rgb('+br2+','+bg2+','+bb2+')';
          ctx.lineWidth = bk2.w;
          ctx.beginPath();
          ctx.moveTo(-hl*0.95, bk2.off*hw*0.7);
          ctx.quadraticCurveTo(0, bk2.off*hw*0.7+(Math.random()-0.5)*3, hl*0.95, bk2.off*hw*0.7);
          ctx.stroke();
        }
        // knots
        for (var kni = 0; kni < ob.knots.length; kni++){
          var kn2 = ob.knots[kni];
          ctx.fillStyle = '#4a3420';
          ctx.beginPath();
          ctx.ellipse(kn2.pos*hl, 0, kn2.s, kn2.s*0.7, 0, 0, Math.PI*2);
          ctx.fill();
          ctx.strokeStyle = '#2e2013';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        // broken ends (light wood)
        ctx.fillStyle = '#a08050';
        ctx.beginPath(); ctx.ellipse(-hl, 0, 3, hw*0.55, 0, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(hl, 0, 3, hw*0.8, 0, 0, Math.PI*2); ctx.fill();
        // top highlight
        ctx.fillStyle = 'rgba(255,235,190,0.18)';
        ctx.fillRect(-hl*0.9, -hw*0.75, hl*1.8, hw*0.35);
        ctx.restore();
      } else if (ob.type === 'twigseg'){
        // invisible collision proxy, skip render
      } else if (ob.type === 'water'){
        // distorted blob path
        function wblob(scale){
          ctx.beginPath();
          var nwb = ob.wob.length;
          for (var wpi = 0; wpi <= nwb; wpi++){
            var wa = wpi/nwb*Math.PI*2;
            var wr = ob.r*ob.wob[wpi % nwb]*scale;
            var wxp = ob.x+Math.cos(wa)*wr;
            var wyp = ob.y+Math.sin(wa)*wr*0.85;
            if (wpi === 0) ctx.moveTo(wxp, wyp);
            else {
              var pa = (wpi-0.5)/nwb*Math.PI*2;
              var pr = ob.r*ob.wob[(wpi-1) % nwb]*scale;
              ctx.quadraticCurveTo(
                ob.x+Math.cos(pa)*pr*1.08, ob.y+Math.sin(pa)*pr*0.92,
                wxp, wyp);
            }
          }
          ctx.closePath();
        }
        ctx.fillStyle = 'rgba(80,140,255,0.18)';
        wblob(1); ctx.fill();
        ctx.strokeStyle = 'rgba(120,180,255,0.4)';
        ctx.lineWidth = 2;
        wblob(1); ctx.stroke();
        // 3D lighting: dark meniscus rim + offset highlight + bottom shade
        // dark inner rim (water edge)
        ctx.save();
        wblob(1); ctx.clip();
        var rimG = ctx.createRadialGradient(ob.x, ob.y, ob.r*0.55,
                                            ob.x, ob.y, ob.r*1.02);
        rimG.addColorStop(0, 'rgba(0,0,0,0)');
        rimG.addColorStop(0.8, 'rgba(20,40,80,0.12)');
        rimG.addColorStop(1, 'rgba(20,40,80,0.35)');
        ctx.fillStyle = rimG;
        ctx.fillRect(ob.x-ob.r*1.2, ob.y-ob.r*1.2, ob.r*2.4, ob.r*2.4);
        // crescent highlight (upper-left, curved for depth)
        var hlG = ctx.createLinearGradient(
          ob.x-ob.r*0.75, ob.y-ob.r*0.75,
          ob.x+ob.r*0.1, ob.y+ob.r*0.1);
        hlG.addColorStop(0, 'rgba(255,255,255,0.7)');
        hlG.addColorStop(0.5, 'rgba(240,248,255,0.3)');
        hlG.addColorStop(1, 'rgba(240,248,255,0)');
        ctx.fillStyle = hlG;
        ctx.beginPath();
        var crx = ob.x-ob.r*0.18, cry = ob.y-ob.r*0.22;
        ctx.ellipse(crx, cry, ob.r*0.48, ob.r*0.36, -0.5, 0, Math.PI*2);
        ctx.ellipse(crx+ob.r*0.14, cry+ob.r*0.10,
                    ob.r*0.38, ob.r*0.28, -0.5, 0, Math.PI*2);
        ctx.fill('evenodd');
        // bottom shade (depth)
        var shG = ctx.createRadialGradient(
          ob.x+ob.r*0.2, ob.y+ob.r*0.45, 1,
          ob.x+ob.r*0.2, ob.y+ob.r*0.45, ob.r*0.5);
        shG.addColorStop(0, 'rgba(10,25,60,0.25)');
        shG.addColorStop(1, 'rgba(10,25,60,0)');
        ctx.fillStyle = shG;
        ctx.beginPath();
        ctx.ellipse(ob.x+ob.r*0.15, ob.y+ob.r*0.4,
                    ob.r*0.45, ob.r*0.28, 0.3, 0, Math.PI*2);
        ctx.fill();
        // bubbles
        for (var bubj = 0; bubj < ob.bubs.length; bubj++){
          var bub = ob.bubs[bubj];
          var bx = ob.x+bub.dx, by = ob.y+bub.dy;
          // bubble body
          ctx.strokeStyle = 'rgba(255,255,255,0.45)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(bx, by, bub.r, 0, Math.PI*2);
          ctx.stroke();
          // bubble highlight
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.beginPath();
          ctx.arc(bx-bub.r*0.3, by-bub.r*0.3, bub.r*0.28, 0, Math.PI*2);
          ctx.fill();
        }
        ctx.restore();

      } else if (ob.type === 'web'){
        // spider web: 3D with ground shadow
        // soft drop shadow (web floats above ground)
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        ctx.beginPath();
        ctx.ellipse(ob.x+6, ob.y+9, ob.r*0.95, ob.r*0.7, 0.15, 0, Math.PI*2);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.beginPath();
        ctx.ellipse(ob.x+10, ob.y+14, ob.r*0.7, ob.r*0.5, 0.15, 0, Math.PI*2);
        ctx.fill();
        // vibrate if ants are struggling inside
        var struggling = false;
        for (var stg = 0; stg < ants.length; stg++){
          var sa = ants[stg];
          if (sa.trapped <= 0) continue;
          var sdx = sa.x-ob.x, sdy = sa.y-ob.y;
          if (sdx*sdx+sdy*sdy < ob.r*ob.r){ struggling = true; break; }
        }
        if (!struggling && assassin && assassin.trapped > 0){
          var asdx2 = assassin.x-ob.x, asdy2 = assassin.y-ob.y;
          if (asdx2*asdx2+asdy2*asdy2 < ob.r*ob.r) struggling = true;
        }
        var vibX = struggling ? (Math.random()-0.5)*3 : 0;
        var vibY = struggling ? (Math.random()-0.5)*3 : 0;
        ctx.save();
        ctx.translate(ob.x+vibX, ob.y+vibY);
        ctx.rotate(ob.rot + (struggling ? (Math.random()-0.5)*0.02 : 0));
        ctx.strokeStyle = 'rgba(220,230,240,0.28)';
        ctx.lineWidth = 1;
        // irregular radials (slight curve, varying length)
        for (var spi = 0; spi < ob.spokes.length; spi++){
          var sa = ob.spokes[spi];
          var sLen = ob.r * (0.85 + Math.random()*0.3);
          var bend = (Math.random()-0.5)*0.15;
          ctx.beginPath();
          ctx.moveTo(Math.cos(sa)*6, Math.sin(sa)*6);
          ctx.quadraticCurveTo(
            Math.cos(sa+bend)*sLen*0.5, Math.sin(sa+bend)*sLen*0.5,
            Math.cos(sa)*sLen, Math.sin(sa)*sLen);
          ctx.stroke();
        }
        // capture spiral (irregular spacing, wider at edges)
        ctx.strokeStyle = 'rgba(220,230,240,0.22)';
        var turns = 5;
        for (var ri = 0; ri < turns; ri++){
          var rr = ob.r * (0.18 + 0.82*Math.pow(ri/(turns-1), 1.3));
          ctx.beginPath();
          var startA = ob.spokes[0], endA = ob.spokes[ob.spokes.length-1];
          // draw arc segments between spokes (skip the gap)
          for (var sgi = 0; sgi < ob.spokes.length-1; sgi++){
            var a0 = ob.spokes[sgi], a1 = ob.spokes[sgi+1];
            var da = a1 - a0;
            if (da < 0) da += Math.PI*2;
            if (da > 1.2) continue; // skip large gaps
            var wob = Math.sin(ri*2.1+sgi)*2; // slight waviness
            ctx.beginPath();
            ctx.arc(0, 0, rr+wob, a0, a1);
            ctx.stroke();
          }
        }
        ctx.restore();
        // 3D dew drops (spherical with highlight)
        for (var dwi = 0; dwi < ob.dew.length; dwi++){
          var dw = ob.dew[dwi];
          var dwx = ob.x+vibX+Math.cos(dw.a+ob.rot)*dw.d*ob.r;
          var dwy = ob.y+vibY+Math.sin(dw.a+ob.rot)*dw.d*ob.r;
          var dwg = ctx.createRadialGradient(dwx-0.8, dwy-0.8, 0.2, dwx, dwy, 2.5);
          dwg.addColorStop(0, 'rgba(255,255,255,0.95)');
          dwg.addColorStop(0.5, 'rgba(200,220,240,0.6)');
          dwg.addColorStop(1, 'rgba(150,180,220,0.15)');
          ctx.fillStyle = dwg;
          ctx.beginPath();
          ctx.arc(dwx, dwy, 2.5, 0, Math.PI*2);
          ctx.fill();
        }
        // raised center hub (3D dome)
        var hubg = ctx.createRadialGradient(ob.x+vibX-1, ob.y+vibY-1, 0.5,
                                            ob.x+vibX, ob.y+vibY, 5);
        hubg.addColorStop(0, 'rgba(240,245,250,0.7)');
        hubg.addColorStop(1, 'rgba(200,210,225,0.2)');
        ctx.fillStyle = hubg;
        ctx.beginPath();
        ctx.arc(ob.x+vibX, ob.y+vibY, 5, 0, Math.PI*2);
        ctx.fill();
      } else if (ob.type === 'leaf'){
        // fallen leaf: pointed oval, vein, autumn tones
        ctx.save();
        ctx.translate(ob.x, ob.y);
        ctx.rotate(ob.ang);
        // shadow (curl)
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(2+ob.curl*10, 3, ob.r, ob.r*0.55, 0, 0, Math.PI*2);
        ctx.fill();
        // leaf body
        var lg = ctx.createLinearGradient(-ob.r, 0, ob.r, 0);
        lg.addColorStop(0, ob.col);
        lg.addColorStop(0.5, shade(ob.col, 1.25));
        lg.addColorStop(1, ob.col);
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.moveTo(-ob.r, 0);
        ctx.quadraticCurveTo(-ob.r*0.3, -ob.r*0.62, ob.r*0.85, -ob.r*0.1);
        ctx.quadraticCurveTo(ob.r, 0, ob.r*0.85, ob.r*0.1);
        ctx.quadraticCurveTo(-ob.r*0.3, ob.r*0.62, -ob.r, 0);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
        // center vein
        ctx.strokeStyle = 'rgba(60,35,15,0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-ob.r*0.9, 0);
        ctx.lineTo(ob.r*0.8, 0);
        ctx.stroke();
        // side veins
        ctx.lineWidth = 0.8;
        for (var vi = 0; vi < 5; vi++){
          var vx = -ob.r*0.6 + vi*ob.r*0.32;
          ctx.beginPath();
          ctx.moveTo(vx, 0);
          ctx.lineTo(vx+ob.r*0.18, -ob.r*0.28);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(vx, 0);
          ctx.lineTo(vx+ob.r*0.18, ob.r*0.28);
          ctx.stroke();
        }
        // bracket fungi (food source)
        if (ob.hasFungus){
          // check if fungus food still available
          var fungAlive = false;
          for (var fchk = 0; fchk < foods.length; fchk++){
            if (foods[fchk].type === 'fungus' && foods[fchk].leaf === ob &&
                foods[fchk].amount > 0){ fungAlive = true; break; }
          }
          if (fungAlive){
            for (var fsi2 = 0; fsi2 < ob.fungSpots.length; fsi2++){
              var fsp = ob.fungSpots[fsi2];
              var fx = Math.cos(fsp.a)*ob.r*fsp.d;
              var fy = Math.sin(fsp.a)*ob.r*fsp.d*0.6;
              // bracket shelf
              var fg = ctx.createLinearGradient(fx-fsp.s, fy, fx+fsp.s, fy);
              fg.addColorStop(0, '#c67a1e');
              fg.addColorStop(0.5, '#e8a83e');
              fg.addColorStop(1, '#a85e14');
              ctx.fillStyle = fg;
              ctx.beginPath();
              ctx.ellipse(fx, fy, fsp.s, fsp.s*0.55, fsp.a, 0, Math.PI*2);
              ctx.fill();
              ctx.strokeStyle = 'rgba(90,50,10,0.5)';
              ctx.lineWidth = 1;
              ctx.stroke();
              // highlight
              ctx.fillStyle = 'rgba(255,220,150,0.4)';
              ctx.beginPath();
              ctx.ellipse(fx-fsp.s*0.2, fy-fsp.s*0.2, fsp.s*0.4, fsp.s*0.2, fsp.a, 0, Math.PI*2);
              ctx.fill();
            }
          }
        }
        ctx.restore();
    }
    }

    // pheromones via ImageData (RGB = 3 colonies)
    var d = pherImg.data;
    // additive blend: each colony's pheromone in its own RGB
    for (var i = 0; i < GW*GH; i++){
      var o = i*4;
      var p0 = pher[0][i], p1 = pher[1][i], p2 = pher[2][i];
      d[o]   = Math.min(255, p0*1.0  + p1*0.31 + p2*1.0);
      d[o+1] = Math.min(255, p0*0.31 + p1*0.55 + p2*0.82);
      d[o+2] = Math.min(255, p0*0.31 + p1*1.0  + p2*0.29);
      d[o+3] = Math.min(160, (p0+p1+p2) * 0.5);
    }
    pherCtx.putImageData(pherImg, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(pherCanvas, 0, 0, W, H);

    // sugar piles
    for (var f = 0; f < foods.length; f++){
      var fd = foods[f];
      if (fd.type !== 'sugar') continue;
      var frac = Math.min(1, fd.amount / 90);
      // soft shadow under pile
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.beginPath();
      ctx.ellipse(fd.x+3, fd.y+5, 26*frac+6, 16*frac+4, 0, 0, Math.PI*2);
      ctx.fill();
      // sugar crystals
      for (var ci2 = 0; ci2 < fd.crystals.length*frac; ci2++){
        var cr = fd.crystals[ci2];
        var twk = 0.7 + 0.3*Math.sin(simT*3 + cr.tw);
        ctx.fillStyle = 'rgba(255,255,255,'+(0.85*twk).toFixed(2)+')';
        ctx.fillRect(fd.x+cr.dx- cr.s/2, fd.y+cr.dy-cr.s/2, cr.s, cr.s);
      }
      // sparkle glints on a few crystals
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (var gi = 0; gi < 3; gi++){
        var gri = (gi*7 + f*3) % fd.crystals.length;
        if (gri < fd.crystals.length*frac){
          var gc = fd.crystals[gri];
          var gx = fd.x+gc.dx, gy = fd.y+gc.dy;
          ctx.fillRect(gx-0.5, gy-3, 1, 6);
          ctx.fillRect(gx-3, gy-0.5, 6, 1);
        }
      }
    }

    // seeds (3D)
    for (var sdi = 0; sdi < foods.length; sdi++){
      var sfd = foods[sdi];
      if (sfd.type !== 'seed' || sfd.amount <= 0) continue;
      var sfrac = Math.min(1, sfd.amount / 12);
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(sfd.x+2, sfd.y+3, 22*sfrac+4, 13*sfrac+3, 0, 0, Math.PI*2);
      ctx.fill();
      var nseed = Math.ceil(sfd.seeds.length * sfrac);
      for (var sei = 0; sei < nseed; sei++){
        var sed = sfd.seeds[sei];
        var sx = sfd.x+sed.dx, sy = sfd.y+sed.dy;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(sed.rot);
        // 3D seed: gradient body
        var seg = ctx.createRadialGradient(-sed.r*0.3, -sed.r*0.3, 0.5,
                                           0, 0, sed.r*1.4);
        var base = Math.floor(120*sed.tone), base2 = Math.floor(85*sed.tone);
        seg.addColorStop(0, 'rgb('+(base+40)+','+(base2+30)+',60)');
        seg.addColorStop(0.7, 'rgb('+base+','+base2+',45)');
        seg.addColorStop(1, 'rgb('+(base-40)+','+(base2-30)+',25)');
        ctx.fillStyle = seg;
        ctx.beginPath();
        ctx.ellipse(0, 0, sed.r, sed.r*0.68, 0, 0, Math.PI*2);
        ctx.fill();
        // hilum (eye)
        ctx.fillStyle = 'rgba(60,40,20,0.6)';
        ctx.beginPath();
        ctx.ellipse(sed.r*0.25, 0, sed.r*0.22, sed.r*0.14, 0, 0, Math.PI*2);
        ctx.fill();
        // highlight
        ctx.fillStyle = 'rgba(255,240,210,0.35)';
        ctx.beginPath();
        ctx.ellipse(-sed.r*0.3, -sed.r*0.25, sed.r*0.3, sed.r*0.16, -0.4, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
      }
    }
    // dead bugs (high-value food)
    for (var dbi = 0; dbi < foods.length; dbi++){
      var bfd = foods[dbi];
      if ((bfd.type !== 'beetle' && bfd.type !== 'fly' && bfd.type !== 'cricket') ||
          bfd.amount <= 0) continue;
      var bfrac = bfd.amount / (bfd.type === 'beetle' ? 12 : 8);
      ctx.save();
      ctx.translate(bfd.x, bfd.y);
      ctx.rotate(bfd.rot);
      var bs = bfd.size * (0.6 + 0.4*bfrac);
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(3, 5, bs*1.1, bs*0.7, 0, 0, Math.PI*2);
      ctx.fill();
      if (bfd.type === 'beetle'){
        // on back, dark shell, curled legs
        ctx.fillStyle = '#1e1a16';
        ctx.beginPath();
        ctx.ellipse(0, 0, bs, bs*0.7, 0, 0, Math.PI*2);
        ctx.fill();
        // shell highlight
        var shg = ctx.createRadialGradient(-bs*0.3, -bs*0.3, 2, 0, 0, bs*1.2);
        shg.addColorStop(0, 'rgba(120,100,80,0.5)');
        shg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = shg;
        ctx.beginPath();
        ctx.ellipse(0, 0, bs, bs*0.7, 0, 0, Math.PI*2);
        ctx.fill();
        // underside segments
        ctx.strokeStyle = 'rgba(150,130,100,0.4)';
        ctx.lineWidth = 1.5;
        for (var bseg = -2; bseg <= 2; bseg++){
          ctx.beginPath();
          ctx.moveTo(-bs*0.7, bseg*bs*0.22);
          ctx.quadraticCurveTo(0, bseg*bs*0.28, bs*0.7, bseg*bs*0.22);
          ctx.stroke();
        }
        // curled legs
        ctx.strokeStyle = '#0f0d0a';
        ctx.lineWidth = 2.5;
        for (var bleg = 0; bleg < 3; bleg++){
          for (var bside = -1; bside <= 1; bside += 2){
            var blx = -bs*0.4 + bleg*bs*0.4;
            ctx.beginPath();
            ctx.moveTo(blx, bside*bs*0.5);
            ctx.quadraticCurveTo(blx+bs*0.2, bside*bs*0.9,
                                blx-bside*bs*0.1, bside*bs*1.1);
            ctx.stroke();
          }
        }
        // head
        ctx.fillStyle = '#2a241e';
        ctx.beginPath();
        ctx.ellipse(bs*0.85, 0, bs*0.3, bs*0.25, 0, 0, Math.PI*2);
        ctx.fill();
      } else if (bfd.type === 'fly'){
        // body
        var fbg = ctx.createLinearGradient(0, -bs*0.4, 0, bs*0.4);
        fbg.addColorStop(0, '#5a5a5a');
        fbg.addColorStop(0.5, '#3a3a3a');
        fbg.addColorStop(1, '#222222');
        ctx.fillStyle = fbg;
        ctx.beginPath();
        ctx.ellipse(0, 0, bs*0.9, bs*0.35, 0, 0, Math.PI*2);
        ctx.fill();
        // segments
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 1;
        for (var fseg = -2; fseg <= 2; fseg++){
          ctx.beginPath();
          ctx.moveTo(fseg*bs*0.25, -bs*0.3);
          ctx.lineTo(fseg*bs*0.25, bs*0.3);
          ctx.stroke();
        }
        // wings (spread flat, veined)
        for (var wside = -1; wside <= 1; wside += 2){
          ctx.fillStyle = 'rgba(220,230,240,0.55)';
          ctx.beginPath();
          ctx.ellipse(wside*bs*0.7, -bs*0.15, bs*0.75, bs*0.32, wside*0.25, 0, Math.PI*2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(150,160,175,0.6)';
          ctx.lineWidth = 0.8;
          // veins
          for (var vn = 0; vn < 4; vn++){
            ctx.beginPath();
            ctx.moveTo(wside*bs*0.15, -bs*0.15);
            ctx.quadraticCurveTo(wside*bs*0.7, -bs*0.15 + (vn-1.5)*bs*0.12,
                                wside*bs*1.35, -bs*0.15 + (vn-1.5)*bs*0.18);
            ctx.stroke();
          }
        }
        // head + eyes
        ctx.fillStyle = '#2a2a2a';
        ctx.beginPath();
        ctx.arc(bs*0.95, 0, bs*0.22, 0, Math.PI*2);
        ctx.fill();
        ctx.fillStyle = '#5a1a1a';
        ctx.beginPath();
        ctx.arc(bs*0.98, -bs*0.08, bs*0.1, 0, Math.PI*2);
        ctx.arc(bs*0.98, bs*0.08, bs*0.1, 0, Math.PI*2);
        ctx.fill();
        // legs
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1.5;
        for (var fleg = 0; fleg < 3; fleg++){
          for (var fside = -1; fside <= 1; fside += 2){
            ctx.beginPath();
            ctx.moveTo(-bs*0.3+fleg*bs*0.3, fside*bs*0.25);
            ctx.lineTo(-bs*0.3+fleg*bs*0.3+bs*0.2, fside*bs*0.6);
            ctx.stroke();
          }
        }
      } else if (bfd.type === 'cricket'){
        // elongated body
        var cbg = ctx.createLinearGradient(0, -bs*0.5, 0, bs*0.5);
        cbg.addColorStop(0, '#8a6a45');
        cbg.addColorStop(0.5, '#6b4f30');
        cbg.addColorStop(1, '#4a3520');
        ctx.fillStyle = cbg;
        ctx.beginPath();
        ctx.ellipse(0, 0, bs*1.1, bs*0.4, 0, 0, Math.PI*2);
        ctx.fill();
        // segments
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1;
        for (var cseg = -3; cseg <= 3; cseg++){
          ctx.beginPath();
          ctx.moveTo(cseg*bs*0.28, -bs*0.35);
          ctx.lineTo(cseg*bs*0.28, bs*0.35);
          ctx.stroke();
        }
        // big hind legs (folded)
        ctx.strokeStyle = '#5a4028';
        ctx.lineWidth = 3;
        for (var cside = -1; cside <= 1; cside += 2){
          ctx.beginPath();
          ctx.moveTo(-bs*0.2, cside*bs*0.3);
          ctx.lineTo(-bs*0.7, cside*bs*0.7);
          ctx.lineTo(-bs*0.1, cside*bs*0.75);
          ctx.stroke();
        }
        // front/mid legs
        ctx.lineWidth = 1.5;
        for (var cleg = 0; cleg < 2; cleg++){
          for (var cside2 = -1; cside2 <= 1; cside2 += 2){
            ctx.beginPath();
            ctx.moveTo(bs*0.3+cleg*bs*0.3, cside2*bs*0.3);
            ctx.lineTo(bs*0.3+cleg*bs*0.3+bs*0.15, cside2*bs*0.65);
            ctx.stroke();
          }
        }
        // antennae (splayed)
        ctx.strokeStyle = '#3a2a18';
        ctx.lineWidth = 1.2;
        for (var cant = -1; cant <= 1; cant += 2){
          ctx.beginPath();
          ctx.moveTo(bs*1.05, cant*bs*0.1);
          ctx.quadraticCurveTo(bs*1.6, cant*bs*0.4, bs*1.9, cant*bs*0.9);
          ctx.stroke();
        }
        // head
        ctx.fillStyle = '#5a4028';
        ctx.beginPath();
        ctx.ellipse(bs*1.05, 0, bs*0.25, bs*0.28, 0, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.restore();
    }
    // anthills
    for (var c = 0; c < 3; c++){
      var np = nestPos(c);
      // subtle selection ring on picked colony
      if (bet === c){
        var pulse = 1 + 0.03*Math.sin(simT*3);
        ctx.save();
        ctx.shadowColor = COLONIES[c].color;
        ctx.shadowBlur = 8;
        ctx.strokeStyle = COLONIES[c].color + 'aa';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(np.x, np.y, 36*pulse, 0, Math.PI*2);
        ctx.stroke();
        ctx.restore();
      }
      // ground shadow
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(np.x+3, np.y+8, 34, 14, 0, 0, Math.PI*2);
      ctx.fill();
      // excavated dirt ring
      ctx.fillStyle = '#3a2a18';
      ctx.beginPath();
      ctx.ellipse(np.x, np.y+4, 32, 18, 0, 0, Math.PI*2);
      ctx.fill();
      // mound: stacked layers for dome shape
      var layers = [
        {ry: 16, rx: 30, col: '#4a3520'},
        {ry: 13, rx: 24, col: '#5a4228'},
        {ry: 10, rx: 18, col: '#6b4f30'},
        {ry: 7,  rx: 12, col: '#7a5c38'}
      ];
      for (var li = 0; li < layers.length; li++){
        var ly = layers[li];
        ctx.fillStyle = ly.col;
        ctx.beginPath();
        ctx.ellipse(np.x, np.y+2-li*3, ly.rx, ly.ry, 0, 0, Math.PI*2);
        ctx.fill();
      }
      // dirt texture pellets
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (var pi = 0; pi < 12; pi++){
        var pa = (pi*2.4 + c*2.1) % (Math.PI*2);
        var pr = 8 + (pi*7 % 18);
        ctx.beginPath();
        ctx.arc(np.x+Math.cos(pa)*pr, np.y-2+Math.sin(pa)*pr*0.55, 1.8, 0, Math.PI*2);
        ctx.fill();
      }
      // colony color band at base
      ctx.strokeStyle = COLONIES[c].color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(np.x, np.y+4, 32, 18, 0, 0.15*Math.PI, 0.85*Math.PI);
      ctx.stroke();
      // entrance hole
      ctx.fillStyle = '#0d0906';
      ctx.beginPath();
      ctx.ellipse(np.x, np.y+6, 7, 5, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.ellipse(np.x, np.y+9, 10, 3, 0, 0, Math.PI*2);
      ctx.fill();
      // banked count above mound
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px "Special Elite", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(COLONIES[c].name + ': ' + banked[c], np.x, np.y - 26);
    }

    // battle flashes
    for (var bfi = 0; bfi < battles.length; bfi++){
      var bf = battles[bfi];
      var bt = bf.t / 30;
      ctx.strokeStyle = 'rgba(255,60,60,'+(1-bt).toFixed(2)+')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bf.x, bf.y, 4+bt*16, 0, Math.PI*2);
      ctx.stroke();
    }

    // assassin bug (bright body for visibility)
    if (assassin){
      ctx.save();
      ctx.translate(assassin.x, assassin.y);
      ctx.rotate(assassin.angle);
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(2, 3, 16, 5, 0, 0, Math.PI*2);
      ctx.fill();
      // 6 long legs
      ctx.strokeStyle = '#8a5a28';
      ctx.lineWidth = 1.5;
      for (var leg = 0; leg < 3; leg++){
        var lx = -8 + leg*8;
        for (var side = -1; side <= 1; side += 2){
          ctx.beginPath();
          ctx.moveTo(lx, 0);
          ctx.lineTo(lx-3, side*10);
          ctx.lineTo(lx-6, side*16);
          ctx.stroke();
        }
      }
      // body: narrow elongated
      var abg = ctx.createLinearGradient(0, -4, 0, 4);
      abg.addColorStop(0, '#d89a4e');
      abg.addColorStop(0.5, '#a06a2e');
      abg.addColorStop(1, '#6b4218');
      ctx.fillStyle = abg;
      ctx.beginPath();
      ctx.ellipse(0, 0, 15, 3.5, 0, 0, Math.PI*2);
      ctx.fill();
      // head (narrow) + rostrum
      ctx.fillStyle = '#c07f35';
      ctx.beginPath();
      ctx.ellipse(15, 0, 5, 2.5, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = '#c07f35';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(19, 0);
      ctx.lineTo(24, 1);
      ctx.stroke();
      // antennae
      ctx.lineWidth = 1;
      for (var ant2 = -1; ant2 <= 1; ant2 += 2){
        ctx.beginPath();
        ctx.moveTo(17, ant2*1);
        ctx.quadraticCurveTo(24, ant2*4, 28, ant2*7);
        ctx.stroke();
      }
      // victim dots on back, colored by colony
      var nv = Math.min(assassin.victims.length, 12);
      for (var ci3 = 0; ci3 < nv; ci3++){
        var stx = -10 + (ci3 % 4)*6;
        var sty = -4 - Math.floor(ci3/4)*3;
        ctx.fillStyle = COLONIES[assassin.victims[ci3]].color;
        ctx.beginPath();
        ctx.arc(stx, sty, 2.2, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.restore();
      // kill count label
      if (assassin.victims.length > 0){
        ctx.fillStyle = '#ff6b6b';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(assassin.victims.length, assassin.x, assassin.y-12);
      }
    }
    // ground ants (oblong, oriented to heading) - fliers drawn after mushrooms
    for (var i = 0; i < ants.length; i++){
      var a = ants[i];
      if (a.flying) continue;
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.angle);
      var acol = a.carrying ? '#ffffff' : COLONIES[a.col].color;
      if (a.warrior && !a.carrying) acol = shade(COLONIES[a.col].color, 0.45);
      else if (a.forager && !a.carrying) acol = shade(acol, 0.7);
      ctx.fillStyle = acol;
      ctx.beginPath();
      if (a.warrior) ctx.ellipse(0, 0, 5.2, 2.6, 0, 0, Math.PI*2);
      else if (a.forager) ctx.ellipse(0, 0, 6.0, 3.0, 0, 0, Math.PI*2);
      else ctx.ellipse(0, 0, 3.5, 1.8, 0, 0, Math.PI*2);
      ctx.fill();
      if (a.warrior){
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(0, 0, 6.6, 3.8, 0, 0, Math.PI*2);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.textAlign = 'left';

    if (!started){
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#e8e6e3';
      ctx.font = '16px "Special Elite", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('PICK A COLONY TO BEGIN FORAGING', W/2, H/2);
      ctx.restore();
      ctx.textAlign = 'left';
    }
    // wind gust streaks
    if (windAnim){
      var wAlpha = 0.45 * (1 - windAnim.t/windAnim.dur);
      ctx.strokeStyle = 'rgba(200,200,200,' + wAlpha.toFixed(3) + ')';
      ctx.lineWidth = 2.5;
      for (var wri = 0; wri < windAnim.lines.length; wri++){
        var wl = windAnim.lines[wri];
        var wx = wl.x + Math.cos(windAnim.angle)*wl.spd*windAnim.t;
        var wy = wl.y + Math.sin(windAnim.angle)*wl.spd*windAnim.t;
        // wrap
        wx = ((wx % W) + W) % W; wy = ((wy % H) + H) % H;
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.lineTo(wx - Math.cos(windAnim.angle)*wl.len, wy - Math.sin(windAnim.angle)*wl.len);
        ctx.stroke();
      }
    }
    // mushrooms (ants crawl behind)
    for (var moi = 0; moi < obstacles.length; moi++){
      var ob = obstacles[moi];
      if (ob.type !== 'mushroom') continue;
        // mushroom cluster: 3D caps + stems
        var sorted = ob.shrooms.slice().sort(function(p,q){ return p.dy-q.dy; });
        for (var mi = 0; mi < sorted.length; mi++){
          var msh = sorted[mi];
          var mxp = ob.x+msh.dx, myp = ob.y+msh.dy;
          // ground shadow
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.beginPath();
          ctx.ellipse(mxp+2, myp+4, msh.capR+4, 6, 0, 0, Math.PI*2);
          ctx.fill();
          // stem (tapered, shaded)
          var stW = msh.capR*0.45;
          var stg = ctx.createLinearGradient(mxp-stW, 0, mxp+stW, 0);
          stg.addColorStop(0, '#8a7a5e');
          stg.addColorStop(0.5, '#c9b891');
          stg.addColorStop(1, '#8a7a5e');
          ctx.fillStyle = stg;
          ctx.beginPath();
          ctx.moveTo(mxp-stW*0.7, myp);
          ctx.lineTo(mxp-stW, myp-msh.h);
          ctx.lineTo(mxp+stW, myp-msh.h);
          ctx.lineTo(mxp+stW*0.7, myp);
          ctx.closePath();
          ctx.fill();
          // cap: dome with 3D shading
          var capY = myp-msh.h;
          var cg = ctx.createRadialGradient(mxp-msh.capR*0.3, capY-msh.capR*0.5, 2,
                                            mxp, capY, msh.capR*1.3);
          cg.addColorStop(0, shade(msh.capCol, 1.35));
          cg.addColorStop(0.6, msh.capCol);
          cg.addColorStop(1, shade(msh.capCol, 0.55));
          ctx.fillStyle = cg;
          ctx.beginPath();
          ctx.ellipse(mxp, capY, msh.capR, msh.capR*0.72, 0, Math.PI, 0);
          ctx.fill();
          // cap rim
          ctx.fillStyle = shade(msh.capCol, 0.7);
          ctx.beginPath();
          ctx.ellipse(mxp, capY, msh.capR, msh.capR*0.2, 0, 0, Math.PI*2);
          ctx.fill();
          // cap highlight
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.beginPath();
          ctx.ellipse(mxp-msh.capR*0.3, capY-msh.capR*0.35,
                      msh.capR*0.35, msh.capR*0.18, -0.4, 0, Math.PI*2);
          ctx.fill();
          // spots
          ctx.fillStyle = 'rgba(255,240,220,0.5)';
          for (var spi2 = 0; spi2 < 4; spi2++){
            var spx = mxp + (spi2*13 % 17 - 8)/17*msh.capR*1.2;
            var spy = capY - msh.capR*0.25 - (spi2*7 % 10)/10*msh.capR*0.3;
            ctx.beginPath();
            ctx.arc(spx, spy, 1.8, 0, Math.PI*2);
            ctx.fill();
          }
        }
    }

    // flying ants: above mushrooms, with shadows and altitude bobbing
    // shadows first (over ground ants, terrain, mushrooms)
    for (var fi = 0; fi < ants.length; fi++){
      var fa = ants[fi];
      if (!fa.flying) continue;
      var falt = Math.pow(0.5 + 0.5*Math.sin(frameCount*0.05 + fa.x*0.05), 0.6);
      var fscale = 2 + falt*2; // 2x to 4x, biased high
      // shadow: offset by altitude, fades as ant climbs
      var shOff = 6 + falt*10;
      var shAlpha = Math.min(0.65, (0.30 - falt*0.12) * 2.0);
      ctx.fillStyle = 'rgba(0,0,0,' + shAlpha.toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(fa.x + shOff*0.6, fa.y + shOff*0.8, 8+fscale*2, 5+fscale, 0.5, 0, Math.PI*2);
      ctx.fill();
    }
    // flying ants themselves
    for (var fj = 0; fj < ants.length; fj++){
      var fb = ants[fj];
      if (!fb.flying) continue;
      var fbalt = Math.pow(0.5 + 0.5*Math.sin(frameCount*0.05 + fb.x*0.05), 0.6);
      var fbscale = 2 + fbalt*2; // 2x to 4x, biased high
      ctx.save();
      ctx.translate(fb.x, fb.y - fbalt*16);
      ctx.rotate(fb.angle);
      ctx.scale(fbscale, fbscale);
      var fbcol = fb.carrying ? '#ffffff' : COLONIES[fb.col].color;
      ctx.fillStyle = fbcol;
      ctx.beginPath();
      ctx.ellipse(0, 0, 3.5, 1.8, 0, 0, Math.PI*2);
      ctx.fill();
      // wings
      var fflap = Math.sin(frameCount*0.5)*0.3;
      ctx.fillStyle = 'rgba(220,230,240,0.6)';
      ctx.beginPath();
      ctx.ellipse(-1, -2.5-fflap, 3.5, 1.8, -0.4-fflap, 0, Math.PI*2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-1, 2.5+fflap, 3.5, 1.8, 0.4+fflap, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }

    // spider (anatomical)
    if (spider){
      ctx.save();
      ctx.translate(spider.x, spider.y);
      ctx.rotate(spider.angle);
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(0, 4, 24, 12, 0, 0, Math.PI*2);
      ctx.fill();
      // 8 legs: all attach to cephalothorax, femur arches up, tibia drops down
      // front legs angle forward, rear legs angle back
      var legBaseX = [14, 10, 5, 0];
      var legDirX = [10, 4, -4, -10]; // forward/back bias
      for (var sleg = 0; sleg < 4; sleg++){
        for (var sside = -1; sside <= 1; sside += 2){
          var phase = simT*9 + sleg*1.7 + (sside > 0 ? Math.PI : 0);
          var step = Math.sin(phase)*3;
          var bx = legBaseX[sleg], by = sside*4;
          // femur: thick, arches up and out
          var fx = bx + legDirX[sleg]*0.4 + step*0.4;
          var fy = sside*(12 + sleg*1.5);
          // knee joint
          var kx = fx + legDirX[sleg]*0.3 + step*0.6;
          var ky = sside*(20 + sleg*2);
          // tarsus: thin, touches ground
          var tx = kx + legDirX[sleg]*0.5 + step;
          var ty = sside*(26 + sleg*2.5);
          // femur (thick)
          ctx.strokeStyle = '#0d0d0d';
          ctx.lineWidth = 3.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.quadraticCurveTo(fx, fy, kx, ky);
          ctx.stroke();
          // tibia + tarsus (thinner)
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(kx, ky);
          ctx.quadraticCurveTo((kx+tx)/2, (ky+ty)/2 + sside*2, tx, ty);
          ctx.stroke();
          // banding on femur
          ctx.strokeStyle = 'rgba(120,120,120,0.4)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo((bx+fx)/2, (by+fy)/2 - 1);
          ctx.lineTo((bx+fx)/2, (by+fy)/2 + 1);
          ctx.stroke();
          ctx.strokeStyle = '#0d0d0d';
        }
      }
      // abdomen (rear, large oval)
      var abdg = ctx.createRadialGradient(-12, -4, 2, -14, 0, 16);
      abdg.addColorStop(0, '#2a2a2a');
      abdg.addColorStop(0.6, '#101010');
      abdg.addColorStop(1, '#000000');
      ctx.fillStyle = abdg;
      ctx.beginPath();
      ctx.ellipse(-14, 0, 13, 9, 0, 0, Math.PI*2);
      ctx.fill();
      // abdomen dorsal pattern (cardiac mark)
      ctx.fillStyle = 'rgba(90,90,90,0.5)';
      ctx.beginPath();
      ctx.ellipse(-14, -1, 6, 2.5, 0, 0, Math.PI*2);
      ctx.fill();
      // spinnerets (rear tip)
      ctx.fillStyle = '#1a1a1a';
      for (var spn = -1; spn <= 1; spn++){
        ctx.beginPath();
        ctx.ellipse(-27, spn*3, 2.5, 1.5, 0, 0, Math.PI*2);
        ctx.fill();
      }
      // pedicel (narrow waist)
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(-2, -2, 4, 4);
      // cephalothorax (front, pear-shaped)
      var cephg = ctx.createRadialGradient(8, -3, 1, 8, 0, 11);
      cephg.addColorStop(0, '#333333');
      cephg.addColorStop(0.7, '#141414');
      cephg.addColorStop(1, '#000000');
      ctx.fillStyle = cephg;
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.bezierCurveTo(16, -7, 6, -8, 0, -5);
      ctx.bezierCurveTo(-2, -3, -2, 3, 0, 5);
      ctx.bezierCurveTo(6, 8, 16, 7, 18, 0);
      ctx.fill();
      // fovea (center groove)
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(6, -3);
      ctx.lineTo(6, 3);
      ctx.stroke();
      // 8 eyes in two rows (4+4)
      ctx.fillStyle = '#000';
      var eyeRows = [[13, -3.5, 1.6], [13, 3.5, 1.6], [15.5, -1.8, 1.2], [15.5, 1.8, 1.2],
                     [11, -4.5, 1.0], [11, 4.5, 1.0], [10, -2, 0.9], [10, 2, 0.9]];
      for (var ei = 0; ei < 8; ei++){
        ctx.beginPath();
        ctx.arc(eyeRows[ei][0], eyeRows[ei][1], eyeRows[ei][2], 0, Math.PI*2);
        ctx.fill();
        // eye shine
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.arc(eyeRows[ei][0]-0.3, eyeRows[ei][1]-0.3, eyeRows[ei][2]*0.35, 0, Math.PI*2);
        ctx.fill();
        ctx.fillStyle = '#000';
      }
      // chelicerae (fangs)
      ctx.fillStyle = '#0a0a0a';
      for (var fg2 = -1; fg2 <= 1; fg2 += 2){
        ctx.beginPath();
        ctx.moveTo(17, fg2*2.5);
        ctx.lineTo(21, fg2*3.5);
        ctx.lineTo(20, fg2*6);
        ctx.lineTo(17, fg2*4);
        ctx.closePath();
        ctx.fill();
      }
      // pedipalps (small feelers beside fangs)
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      for (var pp = -1; pp <= 1; pp += 2){
        ctx.beginPath();
        ctx.moveTo(14, pp*4);
        ctx.quadraticCurveTo(19, pp*7, 22, pp*9);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (winner >= 0){
      ctx.save();
      ctx.fillStyle = COLONIES[winner].color;
      ctx.font = '22px "Special Elite", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(COLONIES[winner].name.toUpperCase() + ' COLONY WINS!', W/2, 34);
      ctx.restore();
      ctx.textAlign = 'left';
    }
  }

  function showVictory(){
    var wc = winner;
    var vCounts = [0,0,0];
    for (var vci = 0; vci < ants.length; vci++) vCounts[ants[vci].col]++;
    document.getElementById('vTitle').textContent =
      COLONIES[wc].name.toUpperCase() + ' COLONY WINS!';
    document.getElementById('vTitle').style.color = COLONIES[wc].color;
    var html = '<table style="width:100%;border-collapse:collapse;font-size:14px;">';
    html += '<tr style="border-bottom:1px solid var(--hatch-widget-border);"><th style="text-align:left;padding:6px;">Colony</th><th style="padding:6px;">Lowest point</th><th style="padding:6px;">Food</th><th style="padding:6px;">Total lost</th><th style="padding:6px;">Total spawned</th></tr>';
    for (var c = 0; c < 3; c++){
      var totalLost = kills[c][0]+kills[c][1]+kills[c][2];
      html += '<tr><td style="padding:6px;color:' + COLONIES[c].color + ';">' + COLONIES[c].name +
        ' (' + vCounts[c] + ')</td>' +
        '<td style="padding:6px;text-align:center;">' + minAnts[c] + '</td>' +
        '<td style="padding:6px;text-align:center;">' + banked[c] + '</td>' +
        '<td style="padding:6px;text-align:center;">' + totalLost + '</td>' +
        '<td style="padding:6px;text-align:center;">' + (totalLost + vCounts[c]) + '</td></tr>';
    }
    html += '</table>';
    // log victory before building play-by-play so it's included
    logEvent(COLONIES[wc].name + ' WINS with ' + banked[wc] + ' food!', 'victory');
    // play by play event log
    var evHtml = '';
    for (var ei = 0; ei < events.length; ei++){
      var ev = events[ei];
      var etm = Math.floor(ev.t);
      var ets = Math.floor(etm/60) + ':' + String(etm%60).padStart(2,'0');
      var etext = ev.text;
      for (var eci = 0; eci < COLONIES.length; eci++){
        var ename = COLONIES[eci].name;
        etext = etext.split(ename).join('<span style="color:' + COLONIES[eci].color + ';font-weight:bold;">' + ename + '</span>');
      }
      var evCol = (typeof EVENT_COLORS !== 'undefined' && EVENT_COLORS[ev.type]) || '#e8e6e3';
      evHtml += '<div style="color:' + evCol + ';">[' + ets + '] ' + etext + '</div>';
    }
    document.getElementById('vEvents').innerHTML = evHtml || '<div>No events recorded.</div>';
    // kills by caste
    html += '<h3>Casualties by Caste</h3><table style="width:100%;border-collapse:collapse;font-size:14px;">';
    html += '<tr style="border-bottom:1px solid var(--hatch-widget-border);"><th style="text-align:left;padding:6px;">Colony</th><th style="padding:6px;">Workers</th><th style="padding:6px;">Foragers</th><th style="padding:6px;">Warriors</th></tr>';
    for (var c2 = 0; c2 < 3; c2++){
      html += '<tr><td style="padding:6px;color:' + COLONIES[c2].color + ';">' + COLONIES[c2].name + '</td>' +
        '<td style="padding:6px;text-align:center;">' + kills[c2][0] + '</td>' +
        '<td style="padding:6px;text-align:center;">' + kills[c2][1] + '</td>' +
        '<td style="padding:6px;text-align:center;">' + kills[c2][2] + '</td></tr>';
    }
    html += '</table>';
    document.getElementById('vStats').innerHTML = html;
    // food chart
    drawFoodChart();
    drawKillChart();
    document.getElementById('victory').style.display = 'block';
  }

  function drawFoodChart(){
    var cv = document.getElementById('vFoodChart');
    var ctx2 = cv.getContext('2d');
    ctx2.clearRect(0, 0, cv.width, cv.height);
    var maxF = 1;
    for (var c = 0; c < 3; c++)
      for (var i = 0; i < foodHist[c].length; i++)
        if (foodHist[c][i] > maxF) maxF = foodHist[c][i];
    var pad = 30;
    // axes
    ctx2.strokeStyle = '#666'; ctx2.lineWidth = 1;
    ctx2.beginPath();
    ctx2.moveTo(pad, 10); ctx2.lineTo(pad, cv.height-pad);
    ctx2.lineTo(cv.width-10, cv.height-pad); ctx2.stroke();
    ctx2.fillStyle = '#999'; ctx2.font = '10px monospace';
    ctx2.fillText(maxF, 4, 16);
    ctx2.fillText('0', 8, cv.height-pad+4);
    // lines
    for (var c2 = 0; c2 < 3; c2++){
      if (foodHist[c2].length < 2) continue;
      ctx2.strokeStyle = COLONIES[c2].color;
      ctx2.lineWidth = 2;
      ctx2.beginPath();
      for (var j = 0; j < foodHist[c2].length; j++){
        var x = pad + j/(foodHist[c2].length-1)*(cv.width-pad-10);
        var y = cv.height-pad - foodHist[c2][j]/maxF*(cv.height-pad-10);
        if (j === 0) ctx2.moveTo(x, y); else ctx2.lineTo(x, y);
      }
      ctx2.stroke();
    }
  }

  function drawKillChart(){
    var cv = document.getElementById('vKillChart');
    var ctx2 = cv.getContext('2d');
    ctx2.clearRect(0, 0, cv.width, cv.height);
    var causes = ['spider', 'assassin', 'combat', 'warrior'];
    var labels = ['Spider', 'Assassin bug', 'Combat', 'Warriors'];
    var maxK = 1;
    for (var ci = 0; ci < 4; ci++)
      for (var c = 0; c < 3; c++)
        if (predKills[causes[ci]][c] > maxK) maxK = predKills[causes[ci]][c];
    var bw = (cv.width-60)/12;
    ctx2.font = '10px monospace';
    // group separators: alternating bg + divider lines
    for (var gbg = 0; gbg < 4; gbg++){
      var gx0 = 40 + gbg*3*bw - 6;
      var gx1 = 40 + (gbg+1)*3*bw - 6;
      if (gbg % 2 === 0){
        ctx2.fillStyle = 'rgba(255,255,255,0.04)';
        ctx2.fillRect(gx0, 10, gx1-gx0, cv.height-40);
      }
      if (gbg > 0){
        ctx2.strokeStyle = '#555';
        ctx2.lineWidth = 1.5;
        ctx2.beginPath();
        ctx2.moveTo(gx0, 10);
        ctx2.lineTo(gx0, cv.height-30);
        ctx2.stroke();
      }
    }
    for (var gi = 0; gi < 4; gi++){
      for (var gc = 0; gc < 3; gc++){
        var v = predKills[causes[gi]][gc];
        var h = v/maxK*(cv.height-50);
        var x = 40 + gi*3*bw + gc*bw;
        ctx2.fillStyle = COLONIES[gc].color;
        ctx2.fillRect(x, cv.height-30-h, bw-2, h);
        if (v > 0){
          ctx2.fillStyle = '#ccc';
          ctx2.fillText(v, x, cv.height-34-h);
        }
      }
      ctx2.fillStyle = '#999';
      ctx2.fillText(labels[gi], 40 + gi*3*bw, cv.height-10);
    }
  }

  function updateStats(){
    var tm = Math.floor(simT);
    timerEl.textContent = Math.floor(tm/60) + ':' + String(tm%60).padStart(2,'0');
    for (var c = 0; c < 3; c++){
      document.getElementById('foodnum'+c).textContent = banked[c];
      document.getElementById('foodbar'+c).style.width = Math.min(100, banked[c]/WIN_FOOD*100) + '%';
    }
    var out = [0,0,0], car = [0,0,0], war = [0,0,0], tot = [0,0,0];
    for (var i = 0; i < ants.length; i++){
      var a = ants[i];
      if (a.forager) out[a.col]++;
      if (a.carrying) car[a.col]++;
      if (a.warrior) war[a.col]++;
      tot[a.col]++;
    }
    for (var c2 = 0; c2 < 3; c2++){
      document.getElementById('out'+c2).textContent = out[c2];
      document.getElementById('car'+c2).textContent = car[c2];
      document.getElementById('war'+c2).textContent = war[c2];
      document.getElementById('tot'+c2).textContent = tot[c2];
      document.getElementById('kw'+c2).textContent = kills[c2][0];
      document.getElementById('kf'+c2).textContent = kills[c2][1];
      document.getElementById('kwar'+c2).textContent = kills[c2][2];
    }
  }

  function populateWorld(){
    try {
      genObstacles();
    } catch(e){ obstacles = []; }
    try { buildNestFlows(); } catch(e){ nestFlow = [null,null,null]; }
    foods = [];
    try {
      for (var f = 0; f < 6; f++) spawnFoodCluster();
    } catch(e){}
    // guarantee at least 3 food clusters
    var guard = 0;
    while (foods.length < 3 && guard++ < 50){
      try { spawnFoodCluster(); } catch(e){ break; }
    }
    // fungus food on 20% of leaves
    try {
      for (var fli = 0; fli < obstacles.length; fli++){
        var lob = obstacles[fli];
        if (lob.type === 'leaf' && lob.hasFungus){
          foods.push({x: lob.x, y: lob.y, amount: 10, type:'fungus',
                      value: 2, leaf: lob});
        }
      }
    } catch(e){}
    // seeds + dead bugs
    try {
      for (var sd = 0; sd < 8; sd++) spawnSeed();
      spawnDeadBug('beetle');
      spawnDeadBug('fly'); spawnDeadBug('fly');
      spawnDeadBug('cricket'); spawnDeadBug('cricket');
    } catch(e){}
    for (var c = 0; c < 3; c++){ pher[c].fill(0); foundFood[c] = []; }
    worldReady = true;
  }

  function reset(){
    for (var c = 0; c < 3; c++) pher[c].fill(0);
    banked = [0,0,0];
    obstacles = []; foods = []; ants = []; battles = [];
    respawning = [false, false, false];
    assassin = null;
    spider = null;
    kills = [[0,0,0],[0,0,0],[0,0,0]];
    events = [];
    peakAnts = [0,0,0]; minAnts = [1e9,1e9,1e9]; totalSpawned = [0,0,0];
    predKills = {spider:[0,0,0], assassin:[0,0,0], combat:[0,0,0], warrior:[0,0,0]};
    foodHist = [[],[],[]];
    milestones = [{},{},{}];
    windAnim = null;
    attackCooldown = [0,0,0];
    var ticker = document.getElementById('ticker');
    if (ticker) ticker.innerHTML = '';
    document.getElementById('victory').style.display = 'none';
    worldReady = false;
    started = false; winner = -1; bet = -1;
    simT = 0;
    var btns = document.querySelectorAll('.colonyBtn');
    for (var b = 0; b < btns.length; b++){
      btns[b].classList.remove('selected');
      btns[b].disabled = false;
    }
    document.getElementById('startBtn').disabled = false;
    document.getElementById('randomBtn').disabled = false;
    statusEl.textContent = 'Pick a colony. First to bank ' + WIN_FOOD + ' food wins.';
    updateStats();
  }

  // --- wiring ---
  var btns = document.querySelectorAll('.colonyBtn');
  for (var bi = 0; bi < btns.length; bi++){
    btns[bi].addEventListener('click', function(){
      if (started) return;
      if (!worldReady){ statusEl.textContent = 'Hit Randomize first to generate the world.'; return; }
      if (ants.length === 0) spawnAnts();
      bet = parseInt(this.getAttribute('data-col'), 10);
      for (var j = 0; j < btns.length; j++) btns[j].classList.remove('selected');
      this.classList.add('selected');
      statusEl.textContent = 'Bet on ' + COLONIES[bet].name + '. Hit Start foraging.';
    });
  }
  document.getElementById('startBtn').addEventListener('click', function(){
    if (bet < 0){ statusEl.textContent = 'Pick a colony first.'; return; }
    started = true;
    this.disabled = true;
    document.getElementById('randomBtn').disabled = true;
    for (var j = 0; j < btns.length; j++) btns[j].disabled = true;
    statusEl.textContent = COLONIES[bet].name + ' colony backed. Foraging underway.';
  });
  document.getElementById('reset10').addEventListener('click', reset);
  document.getElementById('randomBtn').addEventListener('click', function(){
    if (started) return;
    populateWorld();
    ants = [];
    bet = -1;
    var bb = document.querySelectorAll('.colonyBtn');
    for (var bi2 = 0; bi2 < bb.length; bi2++) bb[bi2].classList.remove('selected');
    statusEl.textContent = 'World reshuffled. Pick a colony.';
  });
  window.addEventListener('resize', function(){
    clearTimeout(window.__acT);
    window.__acT = setTimeout(function(){
      var rw = Math.max(320, Math.floor(canvas.getBoundingClientRect().width));
      if (rw !== W){ resize(); reset(); }
    }, 400);
  });

  function frame(){
    if (started && winner < 0){
      simStep();
      simT += 1/60;
    }
    render();
    if ((++frameCount % 10) === 0) updateStats();
    requestAnimationFrame(frame);
  }

  resize();
  reset();
  requestAnimationFrame(frame);
})();
