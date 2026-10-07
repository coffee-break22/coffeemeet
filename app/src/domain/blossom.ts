// @ts-nocheck
// Vendored from npm `edmonds-blossom` v1.0.0 (MIT, Matt Krick,
// https://github.com/mattkrick/EdmondsBlossom), ported from
// http://jorisvr.nl/maximummatching.html.
//
// Why vendored instead of imported: the published package has three
// variables (`b` in addBlossom, `path` in addBlossom, `v` in
// expandBlossom) assigned without `var`/`let`. In Node's CommonJS
// (sloppy mode) that silently creates implicit globals and "works" by
// accident. Vite/Rolldown bundle it as a strict-mode ES module for the
// browser, where an assignment to an undeclared identifier throws
// `ReferenceError: <name> is not defined` instead. It only manifests
// when the algorithm needs to contract an odd cycle ("blossom"), which
// simple/small test graphs don't trigger but realistic compatibility
// graphs do — this is exactly the "No se pudo generar el borrador: b is
// not defined" bug found in production on 2026-09-22. Fix: the three
// missing declarations, marked below with "FIX:"; nothing else changed.

export default function blossom(edges: unknown[], maxCardinality: boolean) {
  if (edges.length === 0) {
    return edges;
  }
  const edmonds = new Edmonds(edges, maxCardinality);
  return edmonds.maxWeightMatching();
}

const Edmonds = function (edges, maxCardinality) {
  this.edges = edges;
  this.maxCardinality = maxCardinality;
  this.nEdge = edges.length;
  this.init();
};

Edmonds.prototype.maxWeightMatching = function () {
  for (var t = 0; t < this.nVertex; t++) {
    this.label = filledArray(2 * this.nVertex, 0);
    this.bestEdge = filledArray(2 * this.nVertex, -1);
    this.blossomBestEdges = initArrArr(2 * this.nVertex);
    this.allowEdge = filledArray(this.nEdge, false);
    this.queue = [];
    for (var v = 0; v < this.nVertex; v++) {
      if (this.mate[v] === -1 && this.label[this.inBlossom[v]] === 0) {
        this.assignLabel(v, 1, -1);
      }
    }
    var augmented = false;
    while (true) {
      while (this.queue.length > 0 && !augmented) {
        v = this.queue.pop();
        for (var ii = 0; ii < this.neighbend[v].length; ii++) {
          var p = this.neighbend[v][ii];
          var k = ~~(p / 2);
          var w = this.endpoint[p];
          if (this.inBlossom[v] === this.inBlossom[w]) continue;
          if (!this.allowEdge[k]) {
            var kSlack = this.slack(k);
            if (kSlack <= 0) {
              this.allowEdge[k] = true;
            }
          }
          if (this.allowEdge[k]) {
            if (this.label[this.inBlossom[w]] === 0) {
              this.assignLabel(w, 2, p ^ 1);
            } else if (this.label[this.inBlossom[w]] === 1) {
              var base = this.scanBlossom(v, w);
              if (base >= 0) {
                this.addBlossom(base, k);
              } else {
                this.augmentMatching(k);
                augmented = true;
                break;
              }
            } else if (this.label[w] === 0) {
              this.label[w] = 2;
              this.labelEnd[w] = p ^ 1;
            }
          } else if (this.label[this.inBlossom[w]] === 1) {
            var b = this.inBlossom[v];
            if (this.bestEdge[b] === -1 || kSlack < this.slack(this.bestEdge[b])) {
              this.bestEdge[b] = k;
            }
          } else if (this.label[w] === 0) {
            if (this.bestEdge[w] === -1 || kSlack < this.slack(this.bestEdge[w])) {
              this.bestEdge[w] = k;
            }
          }
        }
      }
      if (augmented) break;
      var deltaType = -1;
      var delta = [];
      var deltaEdge = [];
      var deltaBlossom = [];
      if (!this.maxCardinality) {
        deltaType = 1;
        delta = getMin(this.dualVar, 0, this.nVertex - 1);
      }
      for (v = 0; v < this.nVertex; v++) {
        if (this.label[this.inBlossom[v]] === 0 && this.bestEdge[v] !== -1) {
          var d = this.slack(this.bestEdge[v]);
          if (deltaType === -1 || d < delta) {
            delta = d;
            deltaType = 2;
            deltaEdge = this.bestEdge[v];
          }
        }
      }
      for (b = 0; b < 2 * this.nVertex; b++) {
        if (this.blossomParent[b] === -1 && this.label[b] === 1 && this.bestEdge[b] !== -1) {
          kSlack = this.slack(this.bestEdge[b]);
          d = kSlack / 2;
          if (deltaType === -1 || d < delta) {
            delta = d;
            deltaType = 3;
            deltaEdge = this.bestEdge[b];
          }
        }
      }
      for (b = this.nVertex; b < this.nVertex * 2; b++) {
        if (this.blossomBase[b] >= 0 && this.blossomParent[b] === -1 && this.label[b] === 2 && (deltaType === -1 || this.dualVar[b] < delta)) {
          delta = this.dualVar[b];
          deltaType = 4;
          deltaBlossom = b;
        }
      }
      if (deltaType === -1) {
        deltaType = 1;
        delta = Math.max(0, getMin(this.dualVar, 0, this.nVertex - 1));
      }
      for (v = 0; v < this.nVertex; v++) {
        var curLabel = this.label[this.inBlossom[v]];
        if (curLabel === 1) {
          this.dualVar[v] -= delta;
        } else if (curLabel === 2) {
          this.dualVar[v] += delta;
        }
      }
      for (b = this.nVertex; b < this.nVertex * 2; b++) {
        if (this.blossomBase[b] >= 0 && this.blossomParent[b] === -1) {
          if (this.label[b] === 1) {
            this.dualVar[b] += delta;
          } else if (this.label[b] === 2) {
            this.dualVar[b] -= delta;
          }
        }
      }
      if (deltaType === 1) {
        break;
      } else if (deltaType === 2) {
        this.allowEdge[deltaEdge] = true;
        var i = this.edges[deltaEdge][0];
        var j = this.edges[deltaEdge][1];
        var wt = this.edges[deltaEdge][2];
        if (this.label[this.inBlossom[i]] === 0) {
          i = i ^ j;
          j = j ^ i;
          i = i ^ j;
        }
        this.queue.push(i);
      } else if (deltaType === 3) {
        this.allowEdge[deltaEdge] = true;
        i = this.edges[deltaEdge][0];
        j = this.edges[deltaEdge][1];
        wt = this.edges[deltaEdge][2];
        this.queue.push(i);
      } else if (deltaType === 4) {
        this.expandBlossom(deltaBlossom, false);
      }
    }
    if (!augmented) break;
    for (b = this.nVertex; b < this.nVertex * 2; b++) {
      if (this.blossomParent[b] === -1 && this.blossomBase[b] >= 0 && this.label[b] === 1 && this.dualVar[b] === 0) {
        this.expandBlossom(b, true);
      }
    }
  }
  for (v = 0; v < this.nVertex; v++) {
    if (this.mate[v] >= 0) {
      this.mate[v] = this.endpoint[this.mate[v]];
    }
  }
  return this.mate;
};

Edmonds.prototype.slack = function (k) {
  var i = this.edges[k][0];
  var j = this.edges[k][1];
  var wt = this.edges[k][2];
  return this.dualVar[i] + this.dualVar[j] - 2 * wt;
};

Edmonds.prototype.blossomLeaves = function (b) {
  if (b < this.nVertex) {
    return [b];
  }
  var leaves = [];
  var childList = this.blossomChilds[b];
  for (var t = 0; t < childList.length; t++) {
    if (childList[t] <= this.nVertex) {
      leaves.push(childList[t]);
    } else {
      var leafList = this.blossomLeaves(childList[t]);
      for (var v = 0; v < leafList.length; v++) {
        leaves.push(leafList[v]);
      }
    }
  }
  return leaves;
};

Edmonds.prototype.assignLabel = function (w, t, p) {
  var b = this.inBlossom[w];
  this.label[w] = this.label[b] = t;
  this.labelEnd[w] = this.labelEnd[b] = p;
  this.bestEdge[w] = this.bestEdge[b] = -1;
  if (t === 1) {
    this.queue.push.apply(this.queue, this.blossomLeaves(b));
  } else if (t === 2) {
    var base = this.blossomBase[b];
    this.assignLabel(this.endpoint[this.mate[base]], 1, this.mate[base] ^ 1);
  }
};

Edmonds.prototype.scanBlossom = function (v, w) {
  var path = [];
  var base = -1;
  while (v !== -1 || w !== -1) {
    var b = this.inBlossom[v];
    if ((this.label[b] & 4)) {
      base = this.blossomBase[b];
      break;
    }
    path.push(b);
    this.label[b] = 5;
    if (this.labelEnd[b] === -1) {
      v = -1;
    } else {
      v = this.endpoint[this.labelEnd[b]];
      b = this.inBlossom[v];
      v = this.endpoint[this.labelEnd[b]];
    }
    if (w !== -1) {
      v = v ^ w;
      w = w ^ v;
      v = v ^ w;
    }
  }
  for (var ii = 0; ii < path.length; ii++) {
    b = path[ii];
    this.label[b] = 1;
  }
  return base;
};

Edmonds.prototype.addBlossom = function (base, k) {
  var v = this.edges[k][0];
  var w = this.edges[k][1];
  var wt = this.edges[k][2];
  var bb = this.inBlossom[base];
  var bv = this.inBlossom[v];
  var bw = this.inBlossom[w];
  var b = this.unusedBlossoms.pop(); // FIX: was missing `var` (implicit global).
  this.blossomBase[b] = base;
  this.blossomParent[b] = -1;
  this.blossomParent[bb] = b;
  var path = (this.blossomChilds[b] = []); // FIX: was missing `var` (implicit global).
  var endPs = this.blossomEndPs[b] = [];
  while (bv !== bb) {
    this.blossomParent[bv] = b;
    path.push(bv);
    endPs.push(this.labelEnd[bv]);
    v = this.endpoint[this.labelEnd[bv]];
    bv = this.inBlossom[v];
  }
  path.push(bb);
  path.reverse();
  endPs.reverse();
  endPs.push((2 * k));
  while (bw !== bb) {
    this.blossomParent[bw] = b;
    path.push(bw);
    endPs.push(this.labelEnd[bw] ^ 1);
    w = this.endpoint[this.labelEnd[bw]];
    bw = this.inBlossom[w];
  }
  this.label[b] = 1;
  this.labelEnd[b] = this.labelEnd[bb];
  this.dualVar[b] = 0;
  var leaves = this.blossomLeaves(b);
  for (var ii = 0; ii < leaves.length; ii++) {
    v = leaves[ii];
    if (this.label[this.inBlossom[v]] === 2) {
      this.queue.push(v);
    }
    this.inBlossom[v] = b;
  }
  var bestEdgeTo = filledArray(2 * this.nVertex, -1);
  var nbLists;
  for (ii = 0; ii < path.length; ii++) {
    bv = path[ii];
    if (this.blossomBestEdges[bv].length === 0) {
      nbLists = [];
      leaves = this.blossomLeaves(bv);
      for (var x = 0; x < leaves.length; x++) {
        v = leaves[x];
        nbLists[x] = [];
        for (var y = 0; y < this.neighbend[v].length; y++) {
          var p = this.neighbend[v][y];
          nbLists[x].push(~~(p / 2));
        }
      }
    } else {
      nbLists = [this.blossomBestEdges[bv]];
    }
    for (x = 0; x < nbLists.length; x++) {
      var nbList = nbLists[x];
      for (y = 0; y < nbList.length; y++) {
        k = nbList[y];
        var i = this.edges[k][0];
        var j = this.edges[k][1];
        wt = this.edges[k][2];
        if (this.inBlossom[j] === b) {
          i = i ^ j;
          j = j ^ i;
          i = i ^ j;
        }
        var bj = this.inBlossom[j];
        if (bj !== b && this.label[bj] === 1 && (bestEdgeTo[bj] === -1 || this.slack(k) < this.slack(bestEdgeTo[bj]))) {
          bestEdgeTo[bj] = k;
        }
      }
    }
    this.blossomBestEdges[bv] = [];
    this.bestEdge[bv] = -1;
  }
  var be = [];
  for (ii = 0; ii < bestEdgeTo.length; ii++) {
    k = bestEdgeTo[ii];
    if (k !== -1) {
      be.push(k);
    }
  }
  this.blossomBestEdges[b] = be;
  this.bestEdge[b] = -1;
  for (ii = 0; ii < this.blossomBestEdges[b].length; ii++) {
    k = this.blossomBestEdges[b][ii];
    if (this.bestEdge[b] === -1 || this.slack(k) < this.slack(this.bestEdge[b])) {
      this.bestEdge[b] = k;
    }
  }
};

Edmonds.prototype.expandBlossom = function (b, endStage) {
  var v; // FIX: was missing `var` (implicit global).
  for (var ii = 0; ii < this.blossomChilds[b].length; ii++) {
    var s = this.blossomChilds[b][ii];
    this.blossomParent[s] = -1;
    if (s < this.nVertex) {
      this.inBlossom[s] = s;
    } else if (endStage && this.dualVar[s] === 0) {
      this.expandBlossom(s, endStage);
    } else {
      var leaves = this.blossomLeaves(s);
      for (var jj = 0; jj < leaves.length; jj++) {
        v = leaves[jj];
        this.inBlossom[v] = s;
      }
    }
  }
  if (!endStage && this.label[b] === 2) {
    var entryChild = this.inBlossom[this.endpoint[this.labelEnd[b] ^ 1]];
    var j = this.blossomChilds[b].indexOf(entryChild);
    var jStep, endpTrick;
    if ((j & 1)) {
      j -= this.blossomChilds[b].length;
      jStep = 1;
      endpTrick = 0;
    } else {
      jStep = -1;
      endpTrick = 1;
    }
    var p = this.labelEnd[b];
    while (j !== 0) {
      this.label[this.endpoint[p ^ 1]] = 0;
      this.label[this.endpoint[pIndex(this.blossomEndPs[b], j - endpTrick) ^ endpTrick ^ 1]] = 0;
      this.assignLabel(this.endpoint[p ^ 1], 2, p);
      this.allowEdge[~~(pIndex(this.blossomEndPs[b], j - endpTrick) / 2)] = true;
      j += jStep;
      p = pIndex(this.blossomEndPs[b], j - endpTrick) ^ endpTrick;
      this.allowEdge[~~(p / 2)] = true;
      j += jStep;
    }
    var bv = pIndex(this.blossomChilds[b], j);
    this.label[this.endpoint[p ^ 1]] = this.label[bv] = 2;

    this.labelEnd[this.endpoint[p ^ 1]] = this.labelEnd[bv] = p;
    this.bestEdge[bv] = -1;
    j += jStep;
    while (pIndex(this.blossomChilds[b], j) !== entryChild) {
      bv = pIndex(this.blossomChilds[b], j);
      if (this.label[bv] === 1) {
        j += jStep;
        continue;
      }
      leaves = this.blossomLeaves(bv);
      for (ii = 0; ii < leaves.length; ii++) {
        v = leaves[ii];
        if (this.label[v] !== 0) break;
      }
      if (this.label[v] !== 0) {
        this.label[v] = 0;
        this.label[this.endpoint[this.mate[this.blossomBase[bv]]]] = 0;
        this.assignLabel(v, 2, this.labelEnd[v]);
      }
      j += jStep;
    }
  }
  this.label[b] = this.labelEnd[b] = -1;
  this.blossomEndPs[b] = this.blossomChilds[b] = [];
  this.blossomBase[b] = -1;
  this.blossomBestEdges[b] = [];
  this.bestEdge[b] = -1;
  this.unusedBlossoms.push(b);
};

Edmonds.prototype.augmentBlossom = function (b, v) {
  var i, j;
  var t = v;
  while (this.blossomParent[t] !== b) {
    t = this.blossomParent[t];
  }
  if (t > this.nVertex) {
    this.augmentBlossom(t, v);
  }
  i = j = this.blossomChilds[b].indexOf(t);
  var jStep, endpTrick;
  if ((i & 1)) {
    j -= this.blossomChilds[b].length;
    jStep = 1;
    endpTrick = 0;
  } else {
    jStep = -1;
    endpTrick = 1;
  }
  while (j !== 0) {
    j += jStep;
    t = pIndex(this.blossomChilds[b], j);
    var p = pIndex(this.blossomEndPs[b], j - endpTrick) ^ endpTrick;
    if (t >= this.nVertex) {
      this.augmentBlossom(t, this.endpoint[p]);
    }
    j += jStep;
    t = pIndex(this.blossomChilds[b], j);
    if (t >= this.nVertex) {
      this.augmentBlossom(t, this.endpoint[p ^ 1]);
    }
    this.mate[this.endpoint[p]] = p ^ 1;
    this.mate[this.endpoint[p ^ 1]] = p;
  }
  this.blossomChilds[b] = this.blossomChilds[b].slice(i).concat(this.blossomChilds[b].slice(0, i));
  this.blossomEndPs[b] = this.blossomEndPs[b].slice(i).concat(this.blossomEndPs[b].slice(0, i));
  this.blossomBase[b] = this.blossomBase[this.blossomChilds[b][0]];
};

Edmonds.prototype.augmentMatching = function (k) {
  var v = this.edges[k][0];
  var w = this.edges[k][1];
  for (var ii = 0; ii < 2; ii++) {
    var s, p;
    if (ii === 0) {
      s = v;
      p = 2 * k + 1;
    } else {
      s = w;
      p = 2 * k;
    }
    while (true) {
      var bs = this.inBlossom[s];
      if (bs >= this.nVertex) {
        this.augmentBlossom(bs, s);
      }
      this.mate[s] = p;
      if (this.labelEnd[bs] === -1) break;
      var t = this.endpoint[this.labelEnd[bs]];
      var bt = this.inBlossom[t];
      s = this.endpoint[this.labelEnd[bt]];
      var j = this.endpoint[this.labelEnd[bt] ^ 1];
      if (bt >= this.nVertex) {
        this.augmentBlossom(bt, j);
      }
      this.mate[j] = this.labelEnd[bt];
      p = this.labelEnd[bt] ^ 1;
    }
  }
};

Edmonds.prototype.init = function () {
  this.nVertexInit();
  this.maxWeightInit();
  this.endpointInit();
  this.neighbendInit();
  this.mate = filledArray(this.nVertex, -1);
  this.label = filledArray(2 * this.nVertex, 0);
  this.labelEnd = filledArray(2 * this.nVertex, -1);
  this.inBlossomInit();
  this.blossomParent = filledArray(2 * this.nVertex, -1);
  this.blossomChilds = initArrArr(2 * this.nVertex);
  this.blossomBaseInit();
  this.blossomEndPs = initArrArr(2 * this.nVertex);
  this.bestEdge = filledArray(2 * this.nVertex, -1);
  this.blossomBestEdges = initArrArr(2 * this.nVertex);
  this.unusedBlossomsInit();
  this.dualVarInit();
  this.allowEdge = filledArray(this.nEdge, false);
  this.queue = [];
};
Edmonds.prototype.blossomBaseInit = function () {
  var base = [];
  for (var i = 0; i < this.nVertex; i++) {
    base[i] = i;
  }
  var negs = filledArray(this.nVertex, -1);
  this.blossomBase = base.concat(negs);
};
Edmonds.prototype.dualVarInit = function () {
  var mw = filledArray(this.nVertex, this.maxWeight);
  var zeros = filledArray(this.nVertex, 0);
  this.dualVar = mw.concat(zeros);
};
Edmonds.prototype.unusedBlossomsInit = function () {
  var i, unusedBlossoms = [];
  for (i = this.nVertex; i < 2 * this.nVertex; i++) {
    unusedBlossoms.push(i);
  }
  this.unusedBlossoms = unusedBlossoms;
};
Edmonds.prototype.inBlossomInit = function () {
  var i, inBlossom = [];
  for (i = 0; i < this.nVertex; i++) {
    inBlossom[i] = i;
  }
  this.inBlossom = inBlossom;
};
Edmonds.prototype.neighbendInit = function () {
  var k, i, j;
  var neighbend = initArrArr(this.nVertex);
  for (k = 0; k < this.nEdge; k++) {
    i = this.edges[k][0];
    j = this.edges[k][1];
    neighbend[i].push(2 * k + 1);
    neighbend[j].push(2 * k);
  }
  this.neighbend = neighbend;
};
Edmonds.prototype.endpointInit = function () {
  var p;
  var endpoint = [];
  for (p = 0; p < 2 * this.nEdge; p++) {
    endpoint[p] = this.edges[~~(p / 2)][p % 2];
  }
  this.endpoint = endpoint;
};
Edmonds.prototype.nVertexInit = function () {
  var nVertex = 0;
  for (var k = 0; k < this.nEdge; k++) {
    var i = this.edges[k][0];
    var j = this.edges[k][1];
    if (i >= nVertex) nVertex = i + 1;
    if (j >= nVertex) nVertex = j + 1;
  }
  this.nVertex = nVertex;
};
Edmonds.prototype.maxWeightInit = function () {
  var maxWeight = 0;
  for (var k = 0; k < this.nEdge; k++) {
    var weight = this.edges[k][2];
    if (weight > maxWeight) {
      maxWeight = weight;
    }
  }
  this.maxWeight = maxWeight;
};

function filledArray(len, fill) {
  var i, newArray = [];
  for (i = 0; i < len; i++) {
    newArray[i] = fill;
  }
  return newArray;
}

function initArrArr(len) {
  var arr = [];
  for (var i = 0; i < len; i++) {
    arr[i] = [];
  }
  return arr;
}

function getMin(arr, start, end) {
  var min = Infinity;
  for (var i = start; i <= end; i++) {
    if (arr[i] < min) {
      min = arr[i];
    }
  }
  return min;
}

function pIndex(arr, idx) {
  return idx < 0 ? arr[arr.length + idx] : arr[idx];
}
