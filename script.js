$(function () {
    var $cont = $('#cont');
    var $result = $('#result');
    var panel = document.getElementById('scoringPanel');
    var scoringTimer = null;
    var scoringTrigger = document.getElementById('scoringButton');
    var form = document.getElementById('scoringForm');
    var traceTimer = null;
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
        GridBuilder.reset();
        $cont.empty();
        $result.empty();
        $('#alignmentScore').empty();
    }
    function buildGrid() {
        var side = $('#seq_1').val(), top = $('#seq_2').val();
        $('#inputError').prop('hidden', true).empty();
        updateSummary();
        if (!side || !top) { clearGrid(); return false; }
        try {
            GridBuilder.rebuildTable($cont, $result, activeScoring.match, activeScoring.mismatch,
                activeScoring.gap, side, top, activeScoring);
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
