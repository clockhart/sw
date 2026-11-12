/* Smith–Waterman local alignment with exact optimal-traceback counts.
 * A gap run of length n scores open + (n - 1) * extend.
 * The three states retain the last move, including for linear gaps, so every
 * alignment is counted once and affine traceback never loses its gap history.
 */
var AlignmentEngine = (function () {
    'use strict';
    var ORDER = ['s', 'u', 'd']; // Preserve the original left, up, diagonal tie order.
    var LABELS = { d: '\u2196 Diagonal', u: '\u2191 Up', s: '\u2190 Left', r: '\u21ba Restart' };
    var DEFAULTS = { substitution: 'simple', match: 1, mismatch: -1,
        gapModel: 'simple', gap: -2, gapOpen: -2, gapExtend: -1 };
    var EPSILON = 1e-9;

    function equal(a, b) { return a === b || Math.abs(a - b) < EPSILON; }
    function format(value) {
        if (!Number.isFinite(value)) { return '\u2212\u221e'; }
        return String(Number(value.toFixed(8)));
    }

    function create(side, top, settings, matrices) {
        var config = Object.assign({}, DEFAULTS, settings || {});
        matrices = matrices || (typeof SubstitutionMatrices !== 'undefined' ? SubstitutionMatrices : {});
        side = side.toUpperCase();
        top = top.toUpperCase();
        ['match', 'mismatch', 'gap', 'gapOpen', 'gapExtend'].forEach(function (key) {
            config[key] = Number(config[key]);
            if (!Number.isFinite(config[key])) { throw new Error('Enter a finite number for ' + key + '.'); }
        });
        if (config.gapModel !== 'simple' && config.gapModel !== 'affine') {
            throw new Error('Choose simple or affine gap scoring.');
        }
        var matrix = config.substitution === 'simple' ? null : matrices[config.substitution];
        if (config.substitution !== 'simple' && !matrix) { throw new Error('Choose a supported substitution matrix.'); }
        if (matrix) {
            [side, top].forEach(function (sequence, index) {
                for (var i = 0; i < sequence.length; i++) {
                    if (!matrix.scores[sequence[i]]) {
                        throw new Error(config.substitution + ' has no score for "' + sequence[i] +
                            '" (Sequence ' + (index + 1) + ', position ' + (i + 1) + ').');
                    }
                }
            });
        }
        var open = config.gapModel === 'affine' ? config.gapOpen : config.gap;
        var extend = config.gapModel === 'affine' ? config.gapExtend : config.gap;
        var cells = [];

        function pair(a, b) { return matrix ? matrix.scores[a][b] : (a === b ? config.match : config.mismatch); }
        function delta(direction, previousState, x, y) {
            if (direction === 'd') { return pair(side[y - 1], top[x - 1]); }
            return direction === previousState ? extend : open;
        }
        function predecessor(x, y, direction) {
            return { x: x - (direction === 'u' ? 0 : 1), y: y - (direction === 's' ? 0 : 1) };
        }
        function get(x, y) { return cells[y] && cells[y][x]; }
        function sources(previous, direction) {
            return ORDER.filter(function (state) {
                var parent = previous.states[state];
                // Trim zero-score prefixes. A gap may retain a nonpositive state
                // for extension, since reopening it would change its affine cost.
                return parent.count && (parent.score > 0 && !equal(parent.score, 0) ||
                    config.gapModel === 'affine' && direction !== 'd' && state === direction);
            }).concat('r');
        }

        var best = 0, ends = [], total = 0n;
        for (var y = 0; y <= side.length; y++) {
            cells[y] = [];
            for (var x = 0; x <= top.length; x++) {
                var cell = { x: x, y: y, states: {
                    r: { score: 0, count: 1n, parents: [] }
                }, score: 0, count: 0n, directions: [] };
                cells[y][x] = cell;
                ORDER.forEach(function (direction) {
                    var state = { score: -Infinity, count: 0n, parents: [] };
                    cell.states[direction] = state;
                    // Boundary cells are zero restarts, never leading gaps.
                    if (!x || !y) { return; }
                    var from = predecessor(x, y, direction);
                    var previous = get(from.x, from.y);
                    if (!previous) { return; }
                    sources(previous, direction).forEach(function (previousState) {
                        var parent = previous.states[previousState];
                        if (!parent || !parent.count) { return; }
                        var contribution = delta(direction, previousState, x, y);
                        var score = parent.score + contribution;
                        if (score > state.score && !equal(score, state.score)) {
                            state.score = score;
                            state.count = 0n;
                            state.parents = [];
                        }
                        if (equal(score, state.score)) {
                            state.count += parent.count;
                            state.parents.push({ state: previousState, x: from.x, y: from.y,
                                previous: parent.score, delta: contribution, score: score });
                        }
                    });
                });
                cell.score = Math.max(0, Math.max.apply(null, ORDER.map(function (state) { return cell.states[state].score; })));
                if (equal(cell.score, 0)) { cell.score = 0; }
                ORDER.forEach(function (state) {
                    if (cell.score > 0 && equal(cell.states[state].score, cell.score) && cell.states[state].count) {
                        cell.directions.push(state);
                        cell.count += cell.states[state].count;
                    }
                });
                if (cell.score > best && !equal(cell.score, best)) { best = cell.score; }
            }
        }
        // Scan columns first, retaining the original SW demo's endpoint order.
        for (x = 1; x <= top.length; x++) {
            for (y = 1; y <= side.length; y++) {
                cell = get(x, y);
                if (best > 0 && equal(cell.score, best)) { ends.push(cell); total += cell.count; }
            }
        }

        function select(branches, rank, count) {
            for (var i = 0; i < branches.length; i++) {
                var size = count(branches[i]);
                if (rank < size) { return { branch: branches[i], rank: rank }; }
                rank -= size;
            }
            throw new Error('Alignment index is outside the available optimal alignments.');
        }
        function traceback(rank) {
            rank = BigInt(rank === undefined ? 0 : rank);
            if (!total && rank === 0n) { return []; }
            if (rank < 0n || rank >= total) { throw new Error('Invalid optimal alignment index.'); }
            var choice = select(ends, rank, function (end) { return end.count; });
            var end = choice.branch, x = end.x, y = end.y;
            choice = select(end.directions, choice.rank, function (state) { return end.states[state].count; });
            var state = choice.branch;
            rank = choice.rank;
            var path = [{ x: x, y: y, state: state }];
            while (state !== 'r') {
                choice = select(get(x, y).states[state].parents, rank, function (parent) {
                    return get(parent.x, parent.y).states[parent.state].count;
                });
                var parent = choice.branch;
                x = parent.x; y = parent.y; state = parent.state; rank = choice.rank;
                path.push({ x: x, y: y, state: state });
            }
            return path;
        }
        function rankPath(path) {
            if (!path.length) { return total ? null : 0n; }
            var end = get(path[0].x, path[0].y);
            if (path.length < 2 || !end || !ends.includes(end)) { return null; }
            var states = [];
            for (var i = 0; i < path.length - 1; i++) {
                var dx = path[i].x - path[i + 1].x, dy = path[i].y - path[i + 1].y;
                if (dx < 0 || dx > 1 || dy < 0 || dy > 1 || !(dx || dy)) { return null; }
                states.push(dx ? (dy ? 'd' : 's') : 'u');
            }
            states.push('r');
            var rank = 0n, found = false;
            for (i = 0; i < ends.length && ends[i] !== end; i++) { rank += ends[i].count; }
            for (i = 0; i < end.directions.length; i++) {
                var direction = end.directions[i];
                if (direction === states[0]) { found = true; break; }
                rank += end.states[direction].count;
            }
            if (!found) { return null; }
            for (i = 0; i < path.length - 1; i++) {
                var cell = get(path[i].x, path[i].y);
                if (!cell) { return null; }
                var parents = cell.states[states[i]].parents;
                found = false;
                for (var p = 0; p < parents.length; p++) {
                    if (parents[p].state === states[i + 1]) { found = true; break; }
                    rank += get(parents[p].x, parents[p].y).states[parents[p].state].count;
                }
                if (!found) { return null; }
            }
            return rank;
        }

        function options(x, y) {
            if (!x || !y) { return []; }
            var cell = get(x, y);
            return ['d', 'u', 's'].filter(function (direction) {
                return cell.states[direction].count > 0n;
            }).map(function (direction) {
                var state = cell.states[direction], parent = state.parents[0];
                var variants = [];
                var from = predecessor(x, y, direction), previous = get(from.x, from.y);
                var availableSources = sources(previous, direction);
                var groups = direction === 'd' || config.gapModel === 'simple' ?
                    [{ label: direction === 'd' ? 'Pair' : 'Gap', states: availableSources }] :
                    [{ label: 'Open', states: availableSources.filter(function (s) { return s !== direction; }) },
                        { label: 'Extend', states: [direction] }];
                groups.forEach(function (group) {
                    var available = group.states.filter(function (s) { return previous.states[s].count; });
                    if (!available.length) { return; }
                    var bestPrevious = Math.max.apply(null, available.map(function (s) { return previous.states[s].score; }));
                    var previousState = available.filter(function (s) { return equal(previous.states[s].score, bestPrevious); })[0];
                    var contribution = delta(direction, previousState, x, y);
                    variants.push({ label: group.label, state: previousState, previous: bestPrevious,
                        delta: contribution, score: bestPrevious + contribution });
                });
                return { direction: direction, label: LABELS[direction], fromX: from.x, fromY: from.y,
                    previous: parent.previous, delta: parent.delta, score: state.score,
                    variants: variants, parents: state.parents };
            }).concat({ direction: 'r', label: LABELS.r, fromX: x, fromY: y,
                previous: 0, delta: 0, score: 0, parents: [],
                variants: [{ label: 'Restart', state: 'r', previous: 0, delta: 0, score: 0 }] });
        }

        return { config: config, side: side, top: top, cells: cells, score: best,
            count: total, endpoints: ends.map(function (end) { return { x: end.x, y: end.y }; }),
            cell: get, pairScore: pair, stepScore: delta,
            options: options, traceback: traceback, rankPath: rankPath, equal: equal };
    }
    return { create: create, defaults: DEFAULTS, equal: equal, format: format };
}());

if (typeof module !== 'undefined' && module.exports) { module.exports = AlignmentEngine; }
