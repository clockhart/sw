const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../AlignmentEngine.js');
const matrices = require('../SubstitutionMatrices.js');

function scoreSteps(steps, side, top, settings) {
    const config = { ...Engine.defaults, ...settings };
    let score = 0, previous = 'r';
    for (const step of steps) {
        if (step.direction === 'd') {
            const a = side[step.y - 1], b = top[step.x - 1];
            score += config.substitution === 'simple' ?
                (a === b ? config.match : config.mismatch) : matrices[config.substitution].scores[a][b];
        } else {
            score += config.gapModel === 'affine' ?
                (previous === step.direction ? config.gapExtend : config.gapOpen) : config.gap;
        }
        previous = step.direction;
    }
    return score;
}

function key(path) { return path.map(p => `${p.x},${p.y}`).join('/'); }
function pathSteps(path) {
    return path.slice(0, -1).map((to, i) => {
        const from = path[i + 1];
        return { ...to, direction: to.x === from.x ? 'u' : to.y === from.y ? 's' : 'd' };
    }).reverse();
}

// Enumerate every possible local aligned string at every position directly.
// No DP table or engine traceback is used to build the expected answers.
function enumerate(side, top, settings) {
    const scores = Array.from({ length: side.length + 1 }, () => Array(top.length + 1).fill(0));
    let best = 0, paths = new Set();
    function visit(x, y, steps, path) {
        const prefixScore = scoreSteps(steps, side, top, settings);
        if (steps.length) {
            scores[y][x] = Math.max(scores[y][x], prefixScore);
            if (prefixScore > best + 1e-9) { best = prefixScore; paths = new Set(); }
            if (best > 1e-9 && Math.abs(prefixScore - best) < 1e-9) { paths.add(key(path.slice().reverse())); }
        }
        for (const [direction, dx, dy] of [['d', 1, 1], ['u', 0, 1], ['s', 1, 0]]) {
            const nx = x + dx, ny = y + dy;
            if (!nx || !ny || nx > top.length || ny > side.length) { continue; }
            // Zero-score prefixes are trimmed. Affine runs can retain their
            // history even at a nonpositive intermediate score.
            if (steps.length && prefixScore <= 1e-9 &&
                !(settings.gapModel === 'affine' && direction !== 'd' && steps.at(-1).direction === direction)) { continue; }
            visit(nx, ny, steps.concat({ x: nx, y: ny, direction }), path.concat({ x: nx, y: ny }));
        }
    }
    for (let y = 0; y <= side.length; y++) for (let x = 0; x <= top.length; x++) visit(x, y, [], [{ x, y }]);
    return { best, paths, scores };
}

function verify(side, top, settings) {
    const expected = enumerate(side, top, settings);
    const model = Engine.create(side, top, settings, matrices);
    const label = `${side}/${top} ${JSON.stringify(settings)}`;
    assert.ok(Math.abs(model.score - expected.best) < 1e-8, label + ': best local score');
    assert.equal(model.count, BigInt(expected.paths.size), label + ': every optimal local placement counted');
    for (const row of model.cells) for (const cell of row) {
        assert.ok(Math.abs(cell.score - expected.scores[cell.y][cell.x]) < 1e-8, label + `: cell ${cell.x},${cell.y}`);
    }
    const actual = new Set();
    for (let rank = 0n; rank < model.count; rank++) {
        const path = model.traceback(rank);
        assert.equal(model.rankPath(path), rank, label + ': rank/unrank');
        assert.equal(path.at(-1).state, 'r', 'traceback ends at a zero restart');
        assert.ok(Math.abs(scoreSteps(pathSteps(path), side, top, settings) - model.score) < 1e-8);
        actual.add(key(path));
    }
    assert.deepEqual(actual, expected.paths, label + ': all optimal paths exactly once');
}

test('local scores, cell values, and tied tracebacks match exhaustive aligned-string enumeration', () => {
    const sequences = ['', 'A', 'B', 'AA', 'AB', 'BA', 'BB', 'AAA', 'ABA', 'BAB'];
    const settings = [
        {}, { match: 0, mismatch: 0, gap: 0 }, { mismatch: -10, gap: -1 }, { gap: 2 },
        { match: 2, mismatch: 0, gap: 0 },
        { gapModel: 'affine', gapOpen: -3, gapExtend: -1 },
        { gapModel: 'affine', gapOpen: -1, gapExtend: -4 },
        { gapModel: 'affine', gapOpen: 2, gapExtend: -1 },
        { gapModel: 'affine', gapOpen: -1, gapExtend: 2 },
        { gapModel: 'affine', gapOpen: 0, gapExtend: 0, match: 0, mismatch: 0 },
        { gapModel: 'affine', gapOpen: -1.1, gapExtend: -0.3, match: 0.7, mismatch: -0.4 }
    ];
    for (const config of settings) for (const side of sequences) for (const top of sequences) verify(side, top, config);
});

test('traceback selects an internal local region and omits both unaligned ends', () => {
    const model = Engine.create('TTACGTAA', 'GGACGTCC', { match: 2, mismatch: -3 });
    assert.equal(model.score, 8);
    assert.equal(model.count, 1n);
    const path = model.traceback();
    assert.deepEqual([path[0].x, path[0].y], [6, 6]);
    assert.deepEqual([path.at(-1).x, path.at(-1).y], [2, 2]);
    for (let i = 0; i <= 8; i++) {
        assert.equal(model.cell(i, 0).score, 0);
        assert.equal(model.cell(0, i).score, 0);
        assert.deepEqual(model.cell(i, 0).directions, []);
    }
});

test('equal maxima at separate local positions are all selectable', () => {
    const model = Engine.create('AAA', 'A');
    assert.equal(model.score, 1);
    assert.equal(model.count, 3n);
    assert.deepEqual([0n, 1n, 2n].map(rank => model.traceback(rank)[0].y), [1, 2, 3]);
    verify('ABA', 'AA', { match: 2, mismatch: -2, gap: -1 });
});

test('affine gaps charge creation once, extension thereafter, within a local region', () => {
    const config = { match: 3, mismatch: -10, gap: -3, gapModel: 'affine', gapOpen: -3, gapExtend: -1 };
    const model = Engine.create('XXAAABBAAAXX', 'YYAAAAAAYY', config);
    assert.equal(model.score, 14);
    assert.equal(model.count, 1n);
    const steps = pathSteps(model.traceback());
    assert.equal(steps.length, 8);
    assert.equal(steps.filter(step => step.direction === 'u').length, 2);
    assert.equal(scoreSteps(steps, model.side, model.top, config), 14);
    const linear = Engine.create(model.side, model.top, { ...config, gapModel: 'simple' });
    assert.equal(linear.score, 12);
});

test('no positive local alignment produces an empty traceback and no alternatives', () => {
    for (const [a, b, config] of [['A', 'B', {}], ['', 'A', {}], ['AAA', 'AAA', { match: 0, gap: 0 }]]) {
        const model = Engine.create(a, b, config);
        assert.equal(model.score, 0);
        assert.equal(model.count, 0n);
        assert.deepEqual(model.traceback(), []);
        assert.deepEqual(model.endpoints, []);
        assert.equal(model.rankPath([]), 0n);
    }
    const model = Engine.create('AB', 'BA');
    assert.equal(model.options(1, 1).at(-1).direction, 'r');
    assert.equal(model.options(1, 1).at(-1).score, 0);
    assert.deepEqual(model.options(1, 0), []);
});

test('bundled protein matrices retain reference values and work with both gap models', () => {
    const expected = { BLOSUM45: [5, 15], BLOSUM50: [5, 15], BLOSUM62: [4, 11],
        BLOSUM80: [7, 16], BLOSUM90: [5, 11], PAM30: [6, 13], PAM70: [5, 13], PAM250: [2, 17] };
    assert.deepEqual(Object.keys(matrices), Object.keys(expected));
    for (const [name, [aa, ww]] of Object.entries(expected)) {
        assert.equal(matrices[name].scores.A.A, aa);
        assert.equal(matrices[name].scores.W.W, ww);
        for (const a of matrices[name].alphabet) for (const b of matrices[name].alphabet) {
            assert.equal(matrices[name].scores[a][b], matrices[name].scores[b][a]);
        }
        for (const gaps of [{}, { gapModel: 'affine', gapOpen: -3, gapExtend: -1 }]) verify('ACG', 'AG', { substitution: name, ...gaps });
    }
});

test('large exact counts support direct selection without enumerating alignments', () => {
    const seq = 'A'.repeat(50);
    const model = Engine.create(seq, seq, { match: 1, gap: 1 });
    assert.equal(model.score, 99);
    function choose(n, k) { let value = 1n; for (let i = 1; i <= k; i++) value = value * BigInt(n - i + 1) / BigInt(i); return value; }
    // Three possible first moves reach (1,1); the rest are 49 left/49 up moves.
    const expected = 3n * choose(98, 49);
    assert.equal(model.count, expected);
    assert.ok(model.count > BigInt(Number.MAX_SAFE_INTEGER));
    for (const rank of [0n, 1n, model.count / 2n, model.count - 1n]) {
        const path = model.traceback(rank);
        assert.equal(model.rankPath(path), rank);
        assert.equal(scoreSteps(pathSteps(path), seq, seq, { match: 1, gap: 1 }), 99);
    }
});

test('matrix orientation, invalid symbols, and non-optimal paths are handled explicitly', () => {
    const library = { asymmetric: { scores: { A: { A: 2, B: 7 }, B: { A: -5, B: 3 } } } };
    assert.equal(Engine.create('A', 'B', { substitution: 'asymmetric', gap: -100 }, library).score, 7);
    assert.equal(Engine.create('B', 'A', { substitution: 'asymmetric', gap: -100 }, library).score, 0);
    assert.throws(() => Engine.create('J', 'A', { substitution: 'BLOSUM62' }, matrices), /Sequence 1, position 1/);
    const model = Engine.create('A', 'A');
    assert.equal(model.rankPath([{ x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }]), null);
    assert.throws(() => model.traceback(-1), /Invalid/);
    assert.throws(() => model.traceback(model.count), /Invalid/);
});
