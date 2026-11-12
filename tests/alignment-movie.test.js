const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../AlignmentEngine.js');
const Movie = require('../AlignmentMovie.js');
const matrices = require('../SubstitutionMatrices.js');

test('every local matrix cell is explained once after all its dependencies', () => {
    for (const [side, top] of [['ABC', 'AB'], ['', 'ABC'], ['ABC', ''], ['', '']]) {
        const engine = Engine.create(side, top);
        const movie = Movie.create(engine);
        const seen = new Set();
        assert.equal(movie.fillCount, (side.length + 1) * (top.length + 1));
        for (let i = 0; i < movie.fillCount; i++) {
            const f = movie.frame(i), { x, y } = f.cell;
            assert.equal(movie.cellIndex(x, y), i);
            assert.equal(f.revealed, i + 1);
            assert.ok(!seen.has(`${x},${y}`));
            for (const from of f.sources) assert.ok(seen.has(`${from.x},${from.y}`), 'restart has no predecessor and never creates a self-dependency');
            if (x && y) {
                for (const [dx, dy] of [[-1, 0], [0, -1], [-1, -1]]) assert.ok(seen.has(`${x + dx},${y + dy}`));
                assert.equal(f.phase, 'Fill matrix');
                assert.equal(Math.max(...f.candidates.map(c => c.score)), f.cell.score);
            } else assert.equal(f.phase, 'Initialize');
            seen.add(`${x},${y}`);
        }
        assert.equal(seen.size, movie.fillCount);
        assert.equal(movie.frame(movie.total - 1).phase, 'Complete');
    }
});

test('simple and affine movies initialize every boundary to zero without gap penalties', () => {
    for (const config of [{ gap: -3 }, { gap: 2 }, { gapModel: 'affine', gapOpen: -5, gapExtend: -1 }]) {
        const engine = Engine.create('AAA', 'AA', config);
        const movie = Movie.create(engine);
        for (const [x, y] of [[1, 0], [2, 0], [0, 1], [0, 3]]) {
            const f = movie.frame(movie.cellIndex(x, y));
            assert.equal(f.cell.score, 0);
            assert.deepEqual(f.candidates, []);
            assert.match(f.description, /no penalty/);
            assert.match(f.reason, /stay at zero/);
        }
    }
});

test('interior cells explain zero as the fourth candidate and restart at nonpositive scores', () => {
    for (const config of [{}, { match: 0, mismatch: 0, gap: 0 }]) {
        const movie = Movie.create(Engine.create('A', 'B', config));
        const f = movie.frame(movie.cellIndex(1, 1));
        assert.equal(f.candidates.length, 4);
        assert.equal(f.candidates.at(-1).direction, 'r');
        assert.equal(f.candidates.at(-1).score, 0);
        assert.equal(f.cell.score, 0);
        assert.deepEqual(f.cell.directions, []);
        assert.match(f.reason, /restart here/);
    }
    const protein = Movie.create(Engine.create('W', 'A', { substitution: 'BLOSUM62' }, matrices));
    assert.match(protein.frame(protein.cellIndex(1, 1)).description, /BLOSUM62 score: -3/);
});

test('local traceback starts at an internal maximum and stops at its internal zero restart', () => {
    const engine = Engine.create('TTACGTAA', 'GGACGTCC', { match: 2, mismatch: -3 });
    const movie = Movie.create(engine);
    const first = movie.frame(movie.fillCount), last = movie.frame(movie.total - 1);
    assert.deepEqual([first.cell.x, first.cell.y], [6, 6]);
    assert.match(first.description, /maximum score anywhere/);
    assert.doesNotMatch(first.description, /bottom-right/);
    assert.equal(last.path.at(-1).state, 'r');
    assert.deepEqual([last.cell.x, last.cell.y], [2, 2]);
    assert.equal(last.suffixScore, 8);
    assert.match(last.description, /zero restart at row 2, column 2/);
    assert.match(last.description, /outside this region are left out/);
});

test('movies retain the selected local alignment, including alternate maximum endpoints', () => {
    const engine = Engine.create('AAA', 'A');
    assert.equal(engine.count, 3n);
    for (let rank = 0n; rank < engine.count; rank++) {
        const movie = Movie.create(engine, rank);
        const first = movie.frame(movie.fillCount), last = movie.frame(movie.total - 1);
        assert.equal(first.cell.y, Number(rank) + 1);
        assert.deepEqual(last.path, engine.traceback(rank));
        assert.equal(engine.rankPath(last.path), rank);
        assert.equal(last.suffixScore, engine.score);
    }
});

test('a zero-score matrix has a completed lesson without a fabricated traceback', () => {
    for (const [a, b, config] of [['AAA', 'BBB', {}], ['', 'A', {}], ['A', 'A', { match: 0, gap: 0 }]]) {
        const movie = Movie.create(Engine.create(a, b, config));
        assert.equal(movie.total, movie.fillCount + 1);
        const last = movie.frame(movie.total - 1);
        assert.equal(last.phase, 'Complete');
        assert.equal(last.revealed, movie.fillCount);
        assert.deepEqual(last.path, []);
        assert.equal(last.goalScore, 0);
        assert.match(last.description, /no traceback to follow/);
        for (let i = 0; i < movie.total; i++) assert.notEqual(movie.frame(i).phase, 'Traceback');
    }
});

test('each local traceback frame reconciles its prefix and suffix, including affine state history', () => {
    const configurations = [{}, { match: 2, mismatch: 0, gap: 0 },
        { match: 3, mismatch: -10, gapModel: 'affine', gapOpen: -3, gapExtend: -1 },
        { match: 2, mismatch: -2, gapModel: 'affine', gapOpen: -1, gapExtend: -4 },
        { match: 0.7, mismatch: -0.4, gapModel: 'affine', gapOpen: -1.1, gapExtend: -0.3 },
        { gapModel: 'affine', gapOpen: -1, gapExtend: 2 },
        { substitution: 'BLOSUM62', gapModel: 'affine', gapOpen: -10, gapExtend: -1 }];
    for (const config of configurations) for (const [a, b] of [['AAAA', 'A'], ['AABBA', 'AAA'], ['HEAGAWGHEE', 'PAWHEAE']]) {
        const engine = Engine.create(a, b, config, matrices);
        if (!engine.count) continue;
        for (const rank of new Set([0n, engine.count / 2n, engine.count - 1n])) {
            const movie = Movie.create(engine, rank), path = engine.traceback(rank);
            for (let step = 0; step < path.length; step++) {
                const f = movie.frame(movie.fillCount + step);
                assert.deepEqual(f.path, path.slice(0, step + 1));
                assert.equal(f.revealed, movie.fillCount);
                assert.ok(engine.equal(f.prefixScore + f.suffixScore, engine.score));
                for (const candidate of f.candidates) for (const variant of candidate.variants) {
                    assert.ok(engine.equal(variant.previous + variant.delta, candidate.score));
                }
            }
            assert.ok(engine.equal(movie.frame(movie.total - 1).suffixScore, engine.score));
        }
    }
});

test('large local movies can be sought directly and reject invalid positions', () => {
    const engine = Engine.create('A'.repeat(100), 'A'.repeat(100));
    const movie = Movie.create(engine);
    const last = movie.frame(movie.total - 1);
    assert.equal(last.phase, 'Complete');
    assert.equal(last.path.length, 101);
    assert.equal(last.path.at(-1).state, 'r');
    assert.equal(movie.frame(movie.cellIndex(50, 50)).cell.score, 50);
    assert.equal(movie.frame(0).revealed, 1);
    assert.throws(() => movie.frame(-1), RangeError);
    assert.throws(() => movie.frame(movie.total), RangeError);
    assert.throws(() => movie.frame(1.5), RangeError);
    assert.throws(() => movie.cellIndex(101, 0), RangeError);
    assert.throws(() => Movie.create(engine, engine.count), /Invalid/);
});
