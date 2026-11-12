$(function () {
    var $cont = $('#cont');
    var $result = $('#result');
    var panel = document.getElementById('scoringPanel');
    var scoringTimer = null;
    var scoringTrigger = document.getElementById('scoringButton');
    var form = document.getElementById('scoringForm');
    var traceTimer = null;
    var movie = null;
    var movieTimer = null;
    var moviePlaying = false;
    var movieSpeeds = [0.25, 0.5, 1, 2, 4, 8, 16];
    var activeScoring = Object.assign({}, AlignmentEngine.defaults);
    var popupView = new URLSearchParams(window.location.search).get('view') === 'matrix';
    var initialState = null;

    if (popupView) {
        $('body').addClass('matrix-window');
        try { initialState = JSON.parse(decodeURIComponent(window.location.hash.slice(1))); }
        catch (e) { /* A direct workspace link uses the default inputs. */ }
        if (initialState && typeof initialState.seq1 === 'string' && typeof initialState.seq2 === 'string') {
            $('#seq_1').val(initialState.seq1);
            $('#seq_2').val(initialState.seq2);
            activeScoring = Object.assign({}, activeScoring, initialState.scoring || {
                match: initialState.match, mismatch: initialState.mismatch, gap: initialState.gap
            });
        }
    }

    var matrixGroups = {};
    Object.keys(SubstitutionMatrices).forEach(function (name) {
        var matrix = SubstitutionMatrices[name];
        if (!matrixGroups[matrix.family]) {
            matrixGroups[matrix.family] = $('<optgroup />').attr('label', matrix.family);
            $('#matrixName').append(matrixGroups[matrix.family]);
        }
        matrixGroups[matrix.family].append($('<option />').val(name).text(matrix.label));
    });

    function format(value) { return AlignmentEngine.format(Number(value)).replace('-', '\u2212'); }
    function signed(value) { return Number(value) >= 0 ? '+' + format(value) : format(value); }
    function number(id, fallback) {
        var text = $(id).val();
        var value = Number(text);
        return text !== '' && Number.isFinite(value) ? value : fallback;
    }
    function readSettings() {
        return {
            substitution: $('input[name="substitutionModel"]:checked').val() === 'matrix' ? $('#matrixName').val() : 'simple',
            match: number('#matchScore', activeScoring.match),
            mismatch: number('#mismatchScore', activeScoring.mismatch),
            gapModel: $('input[name="gapModel"]:checked').val(),
            gap: number('#gapScore', activeScoring.gap),
            gapOpen: number('#gapOpenScore', activeScoring.gapOpen),
            gapExtend: number('#gapExtendScore', activeScoring.gapExtend)
        };
    }
    function updateFields() {
        var matrixMode = $('input[name="substitutionModel"]:checked').val() === 'matrix';
        var affine = $('input[name="gapModel"]:checked').val() === 'affine';
        $('#simpleSubstitutionFields').prop('hidden', matrixMode).find('input').prop('disabled', matrixMode);
        $('#matrixFields').prop('hidden', !matrixMode).find('select').prop('disabled', !matrixMode);
        $('#simpleGapFields').prop('hidden', affine).find('input').prop('disabled', affine);
        $('#affineGapFields').prop('hidden', !affine).find('input').prop('disabled', !affine);
        var matrix = SubstitutionMatrices[$('#matrixName').val()] || SubstitutionMatrices.BLOSUM62;
        $('#matrixDescription').text(matrix.description + ' Supported symbols: ' + matrix.alphabet + '.');
        $('#gapDescription').text(affine ?
            'A gap of length n scores creation + (n \u2212 1) \u00d7 extension. The grid shows zero or the maximum of the paired-letter and two gap states.' :
            'The same score is added for each letter aligned to a gap.');
        $('#scoringError').prop('hidden', true).empty();
        positionScoringPanel();
    }
    function writeSettings() {
        $('input[name="substitutionModel"][value="' + (activeScoring.substitution === 'simple' ? 'simple' : 'matrix') + '"]').prop('checked', true);
        $('input[name="gapModel"][value="' + activeScoring.gapModel + '"]').prop('checked', true);
        $('#matrixName').val(activeScoring.substitution === 'simple' ? 'BLOSUM62' : activeScoring.substitution);
        $('#matchScore').val(activeScoring.match);
        $('#mismatchScore').val(activeScoring.mismatch);
        $('#gapScore').val(activeScoring.gap);
        $('#gapOpenScore').val(activeScoring.gapOpen);
        $('#gapExtendScore').val(activeScoring.gapExtend);
        updateFields();
        $('#scoringForm input').removeAttr('aria-invalid');
    }
    function updateSummary() {
        var pairs = activeScoring.substitution === 'simple' ?
            'Match ' + signed(activeScoring.match) + ' / mismatch ' + signed(activeScoring.mismatch) : activeScoring.substitution;
        var gaps = activeScoring.gapModel === 'affine' ?
            'gap creation ' + format(activeScoring.gapOpen) + ', extension ' + format(activeScoring.gapExtend) :
            'gap ' + format(activeScoring.gap);
        var summary = pairs + ' \u00b7 ' + gaps;
        $('#scoringSummary').text(summary);
        $('.btn-scoring').attr('title', summary).attr('aria-controls', 'scoringPanel')
            .attr('aria-expanded', panel.hidden ? 'false' : 'true').removeAttr('aria-haspopup');
        $('#windowSummary').text($('#seq_1').val().length + ' \u00d7 ' + $('#seq_2').val().length + ' letters \u00b7 ' + summary);
    }
    function clearGrid() {
        stopMovie(false);
        GridBuilder.reset();
        $cont.empty();
        $result.empty();
        $('#alignmentScore').empty();
        $('.btn-movie').prop('disabled', true);
    }
    function buildGrid() {
        stopMovie(false);
        var side = $('#seq_1').val(), top = $('#seq_2').val();
        $('#inputError').prop('hidden', true).empty();
        updateSummary();
        if (!side || !top) { clearGrid(); return false; }
        try {
            GridBuilder.rebuildTable($cont, $result, activeScoring.match, activeScoring.mismatch,
                activeScoring.gap, side, top, activeScoring);
            $('.btn-movie').prop('disabled', false);
            return true;
        } catch (error) {
            clearGrid();
            $('#inputError').text(error.message).prop('hidden', false);
            return false;
        }
    }
    function animateTrace() {
        var $grid = $('#grid');
        $grid.find('.in-path').each(function () {
            this.style.setProperty('--i', $(this).attr('data-index'));
        });
        $grid.addClass('tracing');
        clearTimeout(traceTimer);
        traceTimer = setTimeout(function () { $grid.removeClass('tracing'); },
            40 * $grid.find('.in-path').length + 400);
    }
    function restart() {
        if (!buildGrid()) { return; }
        GridBuilder.highlightOptimal();
        animateTrace();
    }

    function movieSpeed() { return movieSpeeds[Number($('#movieSpeed').val())]; }
    function updateMovieControls() {
        if (!movie) { return; }
        var atEnd = movie.index === movie.plan.total - 1;
        $('#moviePlay').text(moviePlaying ? 'Pause' : atEnd ? 'Replay' : 'Play')
            .attr('aria-label', moviePlaying ? 'Pause movie' : atEnd ? 'Replay movie' : 'Play movie');
        $('#moviePrevious').prop('disabled', movie.index === 0);
        $('#movieNext').prop('disabled', atEnd);
        $('#movieExplanation').attr('aria-live', moviePlaying ? 'off' : 'polite');
    }
    function drawMovie() {
        if (!movie) { return; }
        var frame = movie.plan.frame(movie.index);
        GridBuilder.showMovieFrame(frame);
        $('#moviePhase').text(frame.phase);
        $('#movieCounter').text((movie.index + 1).toLocaleString('en-US') + ' / ' + movie.plan.total.toLocaleString('en-US'));
        $('#movieProgress').val(movie.index).attr('aria-valuetext', frame.phase + ': ' + frame.heading +
            '. Step ' + (movie.index + 1) + ' of ' + movie.plan.total);
        var $explanation = $('#movieExplanation').empty();
        var $heading = $('<div class="movie-heading" />').append($('<strong />').text(frame.heading));
        $heading.append($('<span class="movie-cell-score" />').text('Cell score ' + format(frame.cell.score)));
        $explanation.append($heading, $('<p class="movie-narration" />').text(frame.description));
        var $candidates = $('<div class="movie-candidates" />');
        var trace = frame.path.length > 0;
        function wins(option) {
            return AlignmentEngine.equal(option.score, frame.cell.score) && (frame.cell.score !== 0 || option.direction === 'r');
        }
        var winners = frame.candidates.filter(wins);
        frame.candidates.forEach(function(option) {
            var best = trace || wins(option);
            var $candidate = $('<div class="movie-candidate" />').toggleClass('best', best);
            var operation = option.direction === 'r' ? 'new local alignment' :
                option.direction === 'd' ? 'pair' : 'gap in Seq ' + (option.direction === 'u' ? '2' : '1');
            var $title = $('<div class="movie-candidate-heading" />').append($('<strong />').text(option.label + ' \u00b7 ' + operation));
            if (best) { $title.append($('<span />').text(trace ? 'Chosen' : option.direction === 'r' ? 'Restart' : winners.length > 1 ? 'Tied best' : 'Best')); }
            $candidate.append($title, $('<p class="movie-source-label" />').text(option.direction === 'r' ?
                'Zero reset \u00b7 no predecessor' : 'From row ' + option.fromY + ', column ' + option.fromX));
            option.variants.forEach(function(variant) {
                var label = variant.label === 'Open' ? 'Open: ' : variant.label === 'Extend' ? 'Extend: ' : '';
                var $line = $('<p class="movie-calculation" />').toggleClass('variant-best', AlignmentEngine.equal(variant.score, option.score));
                $line.append(document.createTextNode(label + format(variant.previous) +
                    (variant.delta < 0 ? ' \u2212 ' : ' + ') + format(Math.abs(variant.delta)) + ' = '),
                    $('<b />').text(format(variant.score)));
                $candidate.append($line);
            });
            $candidates.append($candidate);
        });
        $explanation.append($candidates, $('<p class="movie-reason" />').text(frame.reason));
        updateMovieControls();
    }
    function scheduleMovie() {
        clearTimeout(movieTimer);
        if (!movie || !moviePlaying) { return; }
        movieTimer = setTimeout(function() {
            if (!movie || !moviePlaying) { return; }
            if (movie.index < movie.plan.total - 1) { movie.index++; }
            if (movie.index === movie.plan.total - 1) { moviePlaying = false; }
            drawMovie();
            scheduleMovie();
        }, 1000 / movieSpeed());
    }
    function pauseMovie() {
        clearTimeout(movieTimer);
        moviePlaying = false;
        updateMovieControls();
    }
    function stopMovie(restore) {
        clearTimeout(movieTimer);
        moviePlaying = false;
        if (!movie) { return; }
        var previous = movie;
        movie = null;
        GridBuilder.endMovie();
        $('#moviePanel').prop('hidden', true);
        $('.btn-movie').attr('aria-expanded', 'false');
        if (restore) {
            GridBuilder.restorePath(previous.path);
            $cont.scrollLeft(previous.view.left).scrollTop(previous.view.top);
            $result.scrollLeft(previous.view.alignment);
        }
    }
    function startMovie(trigger) {
        if (movie) { stopMovie(true); return; }
        if (!panel.hidden && !applyLiveScoring()) { return; }
        var engine = GridBuilder.alignmentModel();
        if (!engine) { return; }
        clearTimeout(traceTimer);
        var info = GridBuilder.optimalInfo();
        movie = { plan: AlignmentMovie.create(engine, info.index), index: 0,
            path: GridBuilder.exportPath(), trigger: trigger,
            view: { left: $cont.scrollLeft(), top: $cont.scrollTop(), alignment: $result.scrollLeft() } };
        GridBuilder.beginMovie(movie.plan);
        $('#moviePanel').prop('hidden', false);
        $('.btn-movie').attr('aria-expanded', 'true');
        $('#movieProgress').attr('max', movie.plan.total - 1);
        moviePlaying = true;
        drawMovie();
        scheduleMovie();
    }

    function positionScoringPanel() {
        if (panel.hidden) { return; }
        var viewportWidth = document.documentElement.clientWidth;
        var viewportHeight = document.documentElement.clientHeight;
        panel.style.maxHeight = Math.max(0, viewportHeight - 24) + 'px';
        var box = panel.getBoundingClientRect();
        var workspace = document.querySelector('main').getBoundingClientRect();
        var left = Math.max(12, Math.min(workspace.right + 4, viewportWidth - box.width - 12));
        panel.style.left = left + 'px';
        panel.style.right = 'auto';
        var anchor = scoringTrigger.closest('.controls') || scoringTrigger.closest('header');
        var anchorBox = anchor.getBoundingClientRect();
        var preferredTop = left < anchorBox.right ? anchorBox.bottom + 8 : anchorBox.top;
        var top = Math.max(12, Math.min(preferredTop, viewportHeight - box.height - 12));
        panel.style.top = top + 'px';
        panel.style.maxHeight = Math.max(0, viewportHeight - top - 12) + 'px';
    }
    function applyLiveScoring(options) {
        options = options || {};
        clearTimeout(scoringTimer);
        scoringTimer = null;
        var invalid = [];
        form.querySelectorAll('input[type="number"]').forEach(function (input) {
            var valid = input.disabled || input.validity.valid;
            input.setAttribute('aria-invalid', valid ? 'false' : 'true');
            if (!valid) { invalid.push(input); }
        });
        if (invalid.length) {
            var label = invalid[0].closest('label').querySelector('.label').textContent;
            $('#scoringError').text('Enter a valid number for ' + label.toLowerCase() + '.').prop('hidden', false);
            positionScoringPanel();
            return false;
        }
        var candidate = readSettings();
        try {
            AlignmentEngine.create($('#seq_1').val(), $('#seq_2').val(), candidate);
        } catch (error) {
            $('#scoringError').text(error.message + ' Showing the last valid scoring settings.').prop('hidden', false);
            positionScoringPanel();
            return false;
        }
        $('#scoringError').prop('hidden', true).empty();
        positionScoringPanel();
        if (!options.force && JSON.stringify(candidate) === JSON.stringify(activeScoring)) { return true; }
        var path = GridBuilder.exportPath();
        var preservePath = options.preservePath !== false && path.custom;
        var view = { left: $cont.scrollLeft(), top: $cont.scrollTop(), alignment: $result.scrollLeft() };
        clearTimeout(traceTimer);
        activeScoring = candidate;
        if (buildGrid()) {
            $('#grid').addClass('instant');
            if (preservePath) { GridBuilder.restorePath(path); }
            else { GridBuilder.highlightOptimal(); }
            $cont.scrollLeft(view.left).scrollTop(view.top);
            $result.scrollLeft(view.alignment);
        }
        positionScoringPanel();
        return true;
    }
    function updateInputs() {
        clearTimeout(scoringTimer);
        scoringTimer = null;
        if (!panel.hidden && applyLiveScoring({ force: true, preservePath: false })) { return; }
        restart();
    }
    function closeScoring() {
        if (panel.hidden) { return; }
        applyLiveScoring();
        panel.hidden = true;
        $('.btn-scoring').attr('aria-expanded', 'false');
        scoringTrigger.focus({ preventScroll: true });
    }

    writeSettings();
    if (initialState && initialState.path && Array.isArray(initialState.path.cells) && buildGrid()) {
        GridBuilder.restorePath(initialState.path);
    } else { restart(); }

    $('.seq').on('input', updateInputs);
    $('.btn-compute').on('click', function () {
        if (!panel.hidden) { applyLiveScoring(); }
        restart();
    });
    $('.btn-movie').on('click', function() { startMovie(this); });
    $('#moviePlay').on('click', function() {
        if (!movie) { return; }
        if (moviePlaying) { pauseMovie(); return; }
        if (movie.index === movie.plan.total - 1) { movie.index = 0; }
        moviePlaying = true;
        drawMovie();
        scheduleMovie();
    });
    $('#moviePrevious, #movieNext, #movieRestart').on('click', function() {
        if (!movie) { return; }
        pauseMovie();
        movie.index = this.id === 'movieRestart' ? 0 : Math.max(0,
            Math.min(movie.plan.total - 1, movie.index + (this.id === 'movieNext' ? 1 : -1)));
        drawMovie();
    });
    $('#movieProgress').on('input', function() {
        if (!movie) { return; }
        pauseMovie();
        movie.index = Number(this.value);
        drawMovie();
    });
    $('#movieSpeed').on('input', function() {
        $('#movieSpeedValue').text(movieSpeed() + '\u00d7');
        $(this).attr('aria-valuetext', movieSpeed() + ' times normal speed');
        scheduleMovie();
    }).trigger('input');
    $('#movieClose').on('click', function() {
        var trigger = movie && movie.trigger;
        stopMovie(true);
        if (trigger) { trigger.focus({ preventScroll: true }); }
    });
    $('.btn-scoring').on('click', function () {
        if (!panel.hidden) { closeScoring(); return; }
        scoringTrigger = this;
        writeSettings();
        panel.hidden = false;
        panel.scrollTop = 0;
        positionScoringPanel();
        $('.btn-scoring').attr('aria-expanded', 'true');
        var first = readSettings().substitution === 'simple' ? document.getElementById('matchScore') : document.getElementById('matrixName');
        first.focus({ preventScroll: true });
    });
    $('#scoringForm input, #scoringForm select').on('input', function () {
        updateFields();
        clearTimeout(scoringTimer);
        scoringTimer = setTimeout(applyLiveScoring, 100);
    }).on('change', function () {
        updateFields();
        applyLiveScoring();
    });
    $('.scoring-close').on('click', closeScoring);
    $(window).on('resize scroll', positionScoringPanel);
    $(document).on('keydown', function (event) {
        if (event.key === 'Escape' && movie &&
            (document.getElementById('moviePanel').contains(document.activeElement) ||
                document.activeElement.classList.contains('btn-movie'))) {
            event.preventDefault();
            $('#movieClose').click();
        }
        if (event.key === 'Escape' && !panel.hidden &&
            (panel.contains(document.activeElement) || document.activeElement.classList.contains('btn-scoring'))) {
            event.preventDefault();
            closeScoring();
        }
    });
    form.addEventListener('submit', function (event) {
        event.preventDefault();
        applyLiveScoring();
    });
    $('#swapSequences').on('click', function () {
        var first = $('#seq_1').val();
        $('#seq_1').val($('#seq_2').val());
        $('#seq_2').val(first);
        $(this).toggleClass('swapped');
        updateInputs();
    });
    $('.btn-clear').on('click', function () {
        stopMovie(false);
        if (!panel.hidden) { applyLiveScoring(); }
        if ($('#grid').length) { GridBuilder.startCustomPath(); }
    });
    $('#previousAlignment, #nextAlignment').on('click', function () {
        if (scoringTimer !== null) { applyLiveScoring(); }
        if (GridBuilder.moveOptimal(this.id === 'previousAlignment' ? -1 : 1)) { animateTrace(); }
    });
    $('.examples button').on('click', function () {
        clearTimeout(scoringTimer);
        scoringTimer = null;
        var data = $(this).data();
        $('#seq_1').val(data.seq1);
        $('#seq_2').val(data.seq2);
        if (data.match === undefined) {
            updateInputs();
            return;
        }
        activeScoring = Object.assign({}, AlignmentEngine.defaults, {
            match: Number(data.match), mismatch: Number(data.mismatch), gap: Number(data.gap)
        });
        writeSettings();
        restart();
    });
});
