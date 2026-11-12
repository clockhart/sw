/*
 * Copyright (c) 2015 Mostafa Abdelraouf <mostafa.mohmmed@gmail.com> 
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
var GridBuilder = (function () {
    "use strict";
    //Some instance variables
    var mIsFirstCall = true,
        mSelf = null,
        mCurrentPath = [],
        mCellMap = {},
        mEngine = null,
        mScoring = null,
        mOptimalRank = null,
        mTopSequence = "",
        mSideSequence = "",
        mDomGridTable = null,
        mDomAlignmentTable = null,
        mDomContainer = null,
        mDomResultContainer = null,
        mGapSymbol = "-",
        mIsCustomPathMode = false,
        mIsBuildingOptimal = false,
        mMovieActive = false,
        mMovieCells = [],
        mMovieRevealed = 0,
        mActiveAlignmentColumn = null;

    function onCellClicked(dom, x, y, state) {

        x = parseInt(x, 10);
        y = parseInt(y, 10);

        var lastElement = null;
        if (mCurrentPath !== null && mCurrentPath.length !== 0) {
            //If we are not in an empty path, check to see if this is an allowed move
            // Trace backward one step up, left, or diagonally up-left.
            lastElement = mCurrentPath[mCurrentPath.length - 1];

            if (dom.hasClass('in-path')) {
                if (!mIsBuildingOptimal) { mOptimalRank = null; mIsCustomPathMode = true; }

                //Just on entry? Clear path
                if (mCurrentPath.length === 1) {
                    mCurrentPath[0].dom.removeClass('in-path');
                    mCurrentPath[0].dom.removeClass('is-last');
                    mCurrentPath[0].dom.removeAttr('data-index');
                    mCurrentPath = [];
                    onPathUpdate();
                    return true;
                }

                var indexInPath = parseInt(dom.attr('data-index'), 10);
                for (var i = indexInPath + 1; i < mCurrentPath.length; i++) {
                    mCurrentPath[i].dom.removeClass('in-path');
                    mCurrentPath[i].dom.removeClass('is-last');
                    mCurrentPath[i].dom.removeAttr('data-index');
                }
                mCurrentPath.splice(indexInPath + 1, mCurrentPath.length - indexInPath + 1);
                mCurrentPath[mCurrentPath.length - 1].dom.addClass('is-last');
                onPathUpdate();
                return true;
            }

            //An attempt to move in the wrong direction
            if (lastElement.x < x || lastElement.y < y) {
                return false;
            }

            if (x - lastElement.x < -1 || y - lastElement.y < -1) {
                return false;
            }


        }


        if (!mIsBuildingOptimal) { mOptimalRank = null; mIsCustomPathMode = true; }
        if (lastElement) {
            lastElement.state = lastElement.x === x ? 'u' : (lastElement.y === y ? 's' : 'd');
            lastElement.dom.attr('data-path-state', lastElement.state);
        }
        dom.attr('data-index', mCurrentPath.length);
        dom.attr('data-path-state', (x || y) ? (state || '') : '');

        mCurrentPath.push({
            'idx': mCurrentPath.length,
            'x': x,
            'y': y,
            'state': state || ((!x && !y) ? 'd' : null),
            'dom': dom,
            'previous': lastElement
        });

        if (lastElement) {
            lastElement.dom.removeClass('is-last');
        }

        dom.addClass('is-last');
        dom.addClass('in-path');
        onPathUpdate();
        return true;

    }

    function showEmptyAlignment() {
        $('#alignmentScore').text('Score = 0');
        mDomResultContainer.append($('<p class="alignment-empty" />')
            .text('No positive-scoring local alignment. Try different sequences or scoring.'));
    }

    function onPathUpdate() {

        // An optimal traceback adds many cells at once; render its alignment only once.
        if (mIsBuildingOptimal) { return; }
        clearAlignmentInspection();
        updateAlternatives();

        //console.log("Path Updated ========");
        var alignedTopSeq = '';
        var alignedSideSeq = '';
        var steps = [];


        $('th').removeClass('included');
        
        for (var i = mCurrentPath.length - 1; i >= 0; i--) {

            var currentCell = mCurrentPath[i];
            var nextCell = (i > 0) ? mCurrentPath[i - 1] : null;

            var topChar = mTopSequence[currentCell.x];
            var sideChar = mSideSequence[currentCell.y];
            
            
            if (!nextCell) {
                continue;
            }

            steps.push({
                x: nextCell.x, y: nextCell.y,
                fromX: currentCell.x, fromY: currentCell.y,
                fromState: i === mCurrentPath.length - 1 && mIsCustomPathMode ? null : currentCell.state,
                direction: nextCell.x === currentCell.x ? 'u' :
                    (nextCell.y === currentCell.y ? 's' : 'd')
            });

            if(topChar){
                if(currentCell.x != nextCell.x){
                    $('#top_seq_' + (currentCell.x)).addClass('included');
                }
            }

            if(sideChar){
                if(currentCell.y != nextCell.y){
                    $('#side_seq_' + (currentCell.y)).addClass('included');
                }
            }


            //Diagonal move
            if (nextCell.x - currentCell.x > 0 && nextCell.y - currentCell.y > 0) {
                alignedTopSeq += topChar;
                alignedSideSeq += sideChar;
                continue;
            }

            //Horizontal move
            if (nextCell.x - currentCell.x > 0) {
                sideChar = mGapSymbol;
            }

            //Vertical move
            if (nextCell.y - currentCell.y > 0) {
                topChar = mGapSymbol;
            }

            alignedTopSeq += topChar;
            alignedSideSeq += sideChar;

        }

        // Classify each aligned column and total the score.
        var score = 0;
        var columns = [];
        for (var idxTop = 0; idxTop < alignedTopSeq.length; idxTop++) {
            var c1 = alignedTopSeq[idxTop];
            var c2 = alignedSideSeq[idxTop];
            var kind;

            var step = steps[idxTop];
            var contribution = mEngine.stepScore(step.direction, step.fromState, step.x, step.y);
            if (step.direction !== 'd') {
                kind = 'gap';
            } else if (c1 === c2) {
                kind = 'match';
            } else {
                kind = 'mismatch';
            }
            score += contribution;
            columns.push({ top: c1, side: c2, kind: kind, step: step, contribution: contribution });
        }

        var previousScroll = mDomResultContainer.scrollLeft();
        mDomResultContainer.empty();
        $('#alignmentScore').text(columns.length ? 'Score = ' + AlignmentEngine.format(score) : '');
        if (!columns.length) {
            if (!mIsCustomPathMode && mEngine && !mEngine.count && !mMovieActive) { showEmptyAlignment(); }
            return;
        }

        function makeLine(line) {
            var $table = $('<table class="alignment-line" />');
            var $topRow = $('<tr />').append($('<th class="row-label" />').html('Seq 2'));
            var $linkRow = $('<tr class="links" />').append($('<th class="row-label" />'));
            var $sideRow = $('<tr />').append($('<th class="row-label" />').html('Seq 1'));
            for (var k = 0; k < line.length; k++) {
                var col = line[k];
                var label = 'Inspect alignment position ' + (k + 1) + ': Seq 1 ' +
                    (col.side === mGapSymbol ? 'gap' : col.side) + ', Seq 2 ' +
                    (col.top === mGapSymbol ? 'gap' : col.top);
                $topRow.append($('<td />').addClass(col.kind).attr('data-column', k)
                    .append($('<button type="button" class="alignment-position" />')
                        .attr('aria-label', label).text(col.top)));
                $linkRow.append($('<td />').addClass(col.kind).attr('data-column', k)
                    .text(col.kind === 'match' ? '|' : (col.kind === 'mismatch' ? '\u00b7' : '')));
                $sideRow.append($('<td />').addClass(col.kind).attr('data-column', k).text(col.side));
            }
            $table.append($topRow, $linkRow, $sideRow);
            return $table;
        }

        // Keep the full alignment on one line. The result panel scrolls horizontally
        // when needed, leaving short alignments centered at the same readable size.
        var $alignment = $('<div id="alignment" />');
        mDomAlignmentTable = $alignment;
        var $line = makeLine(columns).attr('aria-label', 'Alignment columns 1 to ' + columns.length);
        $alignment.append($line);
        mDomResultContainer.append($alignment).scrollLeft(previousScroll);

        function inspect(cell) {
            var index = Number($(cell).closest('[data-column]').attr('data-column'));
            showAlignmentColumn(columns[index], index, cell);
        }
        $line.on('mouseenter', 'td[data-column]', function() { inspect(this); });
        $line.on('focusin click', '.alignment-position', function() { inspect(this); });
        $line.on('mouseleave', function() {
            if (!this.contains(document.activeElement)) { clearAlignmentInspection(); }
        });
        $line.on('focusout', function(event) {
            if (!this.contains(event.relatedTarget)) { clearAlignmentInspection(); }
        });
        $line.on('keydown', '.alignment-position', function(event) {
            var index = Number($(this).closest('[data-column]').attr('data-column'));
            if (event.key === 'Escape') {
                this.blur();
                clearAlignmentInspection();
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                var next = index + (event.key === 'ArrowRight' ? 1 : -1);
                var button = $line.find('.alignment-position')[next];
                if (next >= 0 && button) { button.focus(); }
            }
        });

    }

    function clearAlignmentInspection() {
        if (mActiveAlignmentColumn !== null) { hideTooltip(); }
        mActiveAlignmentColumn = null;
        if (mDomGridTable) {
            mDomGridTable.find('.alignment-target, .alignment-source, .alignment-header')
                .removeClass('alignment-target alignment-source alignment-header');
        }
        if (mDomAlignmentTable) {
            mDomAlignmentTable.find('.alignment-active').removeClass('alignment-active');
            mDomAlignmentTable.find('[aria-describedby="tooltip"]').removeAttr('aria-describedby');
        }
    }

    // Scroll just the matrix, preserving the page and alignment's positions.
    function revealMatrixCell(cell) {
        var container = mDomContainer[0];
        var box = container.getBoundingClientRect();
        var rect = cell.getBoundingClientRect();
        var header = mDomGridTable.find('th')[0].getBoundingClientRect();
        var left = header.right + 4;
        var top = header.bottom + 4;
        var right = box.left + container.clientWidth - 4;
        var bottom = box.top + container.clientHeight - 4;
        if (rect.left < left || rect.right > right) {
            container.scrollLeft += (rect.left + rect.right - left - right) / 2;
        }
        if (rect.top < top || rect.bottom > bottom) {
            container.scrollTop += (rect.top + rect.bottom - top - bottom) / 2;
        }
    }

    function getCellOptions(x, y) { return mEngine.options(x, y); }

    function stateLabel(state) {
        return { d: 'paired-letter', s: 'gap-in-Seq-1', u: 'gap-in-Seq-2', r: 'zero-restart' }[state] || 'paired-letter';
    }

    function updateAlternatives() {
        var visible = mEngine && mEngine.count > 1n && mOptimalRank !== null && !mIsCustomPathMode && !mMovieActive;
        $('#alignmentAlternatives').prop('hidden', !visible);
        if (!visible) { return; }
        var total = mEngine.count.toString();
        function compact(value) {
            var text = value.toString();
            return text.length > 9 ? '\u2248' + text[0] + '.' + text.slice(1, 3) + '\u00d710^' + (text.length - 1) :
                value.toLocaleString('en-US');
        }
        $('#alignmentIndex').text(compact(mOptimalRank + 1n) + ' of ' + compact(mEngine.count))
            .attr('title', 'Optimal alignment ' + (mOptimalRank + 1n) + ' of ' + total)
            .attr('aria-label', 'Optimal alignment ' + (mOptimalRank + 1n) + ' of ' + total);
        $('#previousAlignment').prop('disabled', mOptimalRank === 0n);
        $('#nextAlignment').attr('title', mOptimalRank + 1n === mEngine.count ?
            'Return to the first optimal alignment' : 'View the next equally scoring alignment');
    }

    function showAlignmentColumn(column, index, anchor) {
        if (!column || (mActiveAlignmentColumn === index &&
            $('#tooltip').is(':visible') && $('#tooltip .alignment-explanation').length)) { return; }
        clearAlignmentInspection();
        mActiveAlignmentColumn = index;
        var step = column.step;
        var target = document.getElementById(step.x + '_' + step.y);
        var source = document.getElementById(step.fromX + '_' + step.fromY);
        $(target).addClass('alignment-target');
        $(source).addClass('alignment-source');
        $('#top_seq_' + (step.x - 1) + ', #side_seq_' + (step.y - 1)).addClass('alignment-header');
        mDomAlignmentTable.find('[data-column="' + index + '"]').addClass('alignment-active');
        mDomAlignmentTable.find('[data-column="' + index + '"] .alignment-position')
            .attr('aria-describedby', 'tooltip');
        revealMatrixCell(target);

        var options = getCellOptions(step.x, step.y);
        var best = mCellMap[step.x + '_' + step.y].winningScore;
        var chosen = options.filter(function(o) { return o.direction === step.direction; })[0];
        if (!chosen) {
            chosen = { previous: 0, delta: column.contribution, score: column.contribution };
        }
        var winners = options.filter(function(o) { return mEngine.equal(o.score, best); });
        var affine = mScoring.gapModel === 'affine';
        var partialStart = affine && !step.fromState;
        var transition = chosen;
        if (affine) {
            var previousCell = mEngine.cell(step.fromX, step.fromY);
            var previous = partialStart ? 0 : previousCell.states[step.fromState].score;
            transition = { previous: previous, delta: column.contribution, score: previous + column.contribution };
        }
        var move = { d: 'diagonal', u: 'up', s: 'left' }[step.direction];
        var description = column.kind === 'gap' ?
            'Gap in Seq ' + (column.side === mGapSymbol ? '1' : '2') :
            (column.kind === 'match' ? 'Match' : 'Mismatch') + ': ' + column.side + ' / ' + column.top;
        if (affine && column.kind === 'gap') {
            description += step.fromState === step.direction ? ' \u00b7 extend' : ' \u00b7 open';
        }
        if (mScoring.substitution !== 'simple' && column.kind !== 'gap') { description += ' \u00b7 ' + mScoring.substitution; }
        var contribution = column.contribution;
        var $explanation = $('<div class="alignment-explanation" />');
        $explanation.append($('<strong class="tooltip-title" />').text('Alignment position ' + (index + 1)));
        $explanation.append($('<p class="tooltip-meta" />').text('Row ' + step.y + ', column ' + step.x +
            ' \u00b7 ' + description + ' (' + (contribution >= 0 ? '+' : '') + AlignmentEngine.format(contribution) + ')'));
        var $options = $('<div class="score-options" aria-label="Matrix candidate scores" />');
        options.forEach(function(o) {
            var selected = o === chosen;
            var calculation = selected ? transition : o;
            var $row = $('<div class="score-option" />').toggleClass('chosen', selected);
            $row.append($('<span />').text(o.label + (selected ? ' \u00b7 chosen' : '')));
            $row.append($('<span class="option-value" />').text(AlignmentEngine.format(calculation.previous) +
                (calculation.delta < 0 ? ' \u2212 ' : ' + ') + AlignmentEngine.format(Math.abs(calculation.delta)) +
                ' = ' + AlignmentEngine.format(calculation.score)));
            $options.append($row);
        });
        $explanation.append($options);
        var reason;
        if (partialStart) {
            reason = 'This partial path starts at row ' + step.fromY + ', column ' + step.fromX +
                '. Its first step contributes ' + AlignmentEngine.format(contribution) +
                '; matrix candidates use local alignment states.';
        } else if (!step.x || !step.y) {
            reason = 'Smith\u2013Waterman keeps the first row and column at zero. This manually selected boundary gap is scored separately.';
        } else if (affine && (mOptimalRank !== null || mMovieActive) && !mEngine.equal(transition.score, best)) {
            reason = 'This optimal traceback retains the ' + stateLabel(step.direction) + ' state (score ' +
                AlignmentEngine.format(transition.score) + ') to preserve its gap history. The displayed cell maximum is ' +
                AlignmentEngine.format(best) + '.';
        } else if (affine && transition.score < chosen.score && !mEngine.equal(transition.score, chosen.score)) {
            reason = 'This custom transition scores ' + AlignmentEngine.format(transition.score) +
                '; the best ' + stateLabel(step.direction) + ' state scores ' + AlignmentEngine.format(chosen.score) + '.';
        } else if (chosen.score < best && !mEngine.equal(chosen.score, best)) {
            reason = 'This custom step uses a matrix candidate of ' + AlignmentEngine.format(chosen.score) +
                ', below the best available score (' + AlignmentEngine.format(best) + ').';
        } else if (step.fromState === 'r' && (mOptimalRank !== null || mMovieActive)) {
            reason = 'This local alignment starts at row ' + step.fromY + ', column ' + step.fromX +
                ' with score 0. The ' + move + ' step contributes ' + AlignmentEngine.format(contribution) + '.';
        } else if (winners.length > 1) {
            reason = 'The ' + move + ' candidate ties for the best score (' + AlignmentEngine.format(best) +
                '). There are ' + winners.length + ' equally scoring moves at this cell.';
        } else {
            reason = 'The ' + move + ' candidate gives the highest score at this cell (' + AlignmentEngine.format(best) + ').';
        }
        $explanation.append($('<p class="tooltip-reason" />').text(reason));
        var position = $(anchor).offset();
        var targetBox = target.getBoundingClientRect();
        var sourceBox = source.getBoundingClientRect();
        displayTooltip($explanation, position.left, position.top - 8, true, {
            left: Math.min(targetBox.left, sourceBox.left) + window.scrollX,
            right: Math.max(targetBox.right, sourceBox.right) + window.scrollX,
            top: Math.min(targetBox.top, sourceBox.top) + window.scrollY,
            bottom: Math.max(targetBox.bottom, sourceBox.bottom) + window.scrollY
        });
    }

    function displayTooltip(text, x, y, above, avoid) {

        if ($('#tooltip').length === 0) {
            $('body').prepend($('<div role="tooltip" />').attr('id', 'tooltip'));
        }
        var viewportWidth = document.documentElement.clientWidth;
        var viewportHeight = document.documentElement.clientHeight;
        var tt = $('#tooltip').empty().append(text).css({ display: 'block', left: 0, top: 0,
            maxWidth: Math.max(1, Math.min(480, viewportWidth - 16)) });
        if (above) { y -= tt.outerHeight(); }
        var minX = window.scrollX + 8, minY = window.scrollY + 8;
        var width = tt.outerWidth(), height = tt.outerHeight();
        var maxX = minX + viewportWidth - width - 16;
        var maxY = minY + viewportHeight - height - 16;
        x = Math.max(minX, Math.min(x, maxX));
        y = Math.max(minY, Math.min(y, maxY));
        // Keep both highlighted matrix cells visible alongside their explanation.
        if (avoid && x < avoid.right && x + width > avoid.left &&
            y < avoid.bottom && y + height > avoid.top) {
            if (avoid.left - width - 8 >= minX) { x = avoid.left - width - 8; }
            else if (avoid.right + 8 <= maxX) { x = avoid.right + 8; }
            else if (avoid.top - height - 8 >= minY) { y = avoid.top - height - 8; }
            else if (avoid.bottom + 8 <= maxY) { y = avoid.bottom + 8; }
        }
        tt.css({ left: x, top: y });
    }

    function hideTooltip() {
        $('#tooltip').css('display', 'none');
    }

    function showTooltip(x, y) {
        x = Number(x);
        y = Number(y);
        var best = mCellMap[x + '_' + y].winningScore;
        var options = getCellOptions(x, y);
        var winners = options.filter(function(o) { return mEngine.equal(o.score, best); });
        var isMatch = x > 0 && y > 0 && mTopSequence[x - 1] === mSideSequence[y - 1];
        function number(value) { return AlignmentEngine.format(value).replace('-', '\u2212'); }
        function signed(value) { return value >= 0 ? '+' + number(value) : number(value); }

        var $content = $('<div class="matrix-explanation" />');
        var $heading = $('<div class="matrix-tooltip-head" />');
        $heading.append($('<div />')
            .append($('<span class="tooltip-eyebrow" />').text('Scoring matrix'))
            .append($('<strong class="tooltip-title" />').text('Row ' + y + ' \u00b7 Column ' + x)));
        $heading.append($('<div class="matrix-cell-score" />')
            .append($('<span />').text('Cell score')).append($('<strong />').text(number(best))));
        $content.append($heading);
        if (x || y) {
            var $comparison = $('<p class="matrix-comparison" />');
            $comparison.append($('<span />').text('Seq 1: ').append($('<b />').text(y ? mSideSequence[y - 1] : '\u2014')));
            $comparison.append($('<span />').text('Seq 2: ').append($('<b />').text(x ? mTopSequence[x - 1] : '\u2014')));
            $comparison.append($('<span class="matrix-comparison-score" />').text(
                x && y ? (mScoring.substitution === 'simple' ? (isMatch ? 'Match ' : 'Mismatch ') : mScoring.substitution + ' ') +
                    signed(mEngine.pairScore(mSideSequence[y - 1], mTopSequence[x - 1])) :
                    'Zero boundary'));
            $content.append($comparison);
        }

        var $options = $('<div class="matrix-options" />');
        options.forEach(function(o) {
            var winner = mEngine.equal(o.score, best);
            var operation = o.direction === 'r' ? 'start a new local alignment' :
                o.direction === 'd' ? (isMatch ? 'match' : 'mismatch') :
                    'gap in Seq ' + (o.direction === 'u' ? '2' : '1');
            var $option = $('<div class="matrix-option" />').toggleClass('best', winner);
            var $label = $('<div class="matrix-option-heading" />')
                .append($('<strong />').text(o.label + ' \u00b7 ' + operation));
            if (winner) {
                $label.append($('<span class="matrix-best" />').text(winners.length > 1 ? 'Tied best' : 'Best'));
            }
            $option.append($label);
            o.variants.forEach(function(variant) {
                var affineGap = mScoring.gapModel === 'affine' && o.direction !== 'd' && o.direction !== 'r';
                var source = o.direction === 'r' ? 'Zero reset' : 'From row ' + o.fromY + ', col ' + o.fromX;
                if (affineGap) { source = variant.label + ' \u00b7 row ' + o.fromY + ', col ' + o.fromX + ' \u00b7 ' + stateLabel(variant.state); }
                var $calculation = $('<div class="matrix-calculation" />')
                    .toggleClass('variant-best', mEngine.equal(variant.score, o.score))
                    .append($('<span class="matrix-source" />').text(source));
                $calculation.append($('<span class="option-value" />')
                    .append(document.createTextNode(number(variant.previous) + (variant.delta < 0 ? ' \u2212 ' : ' + ') +
                        AlignmentEngine.format(Math.abs(variant.delta)) + ' = '))
                    .append($('<b />').text(number(variant.score))));
                $option.append($calculation);
            });
            $options.append($option);
            $(document.getElementById(o.fromX + '_' + o.fromY)).addClass('highlight');
        });
        $content.append($options);
        var reason;
        if (!x || !y) { reason = 'The first row and column are initialized to 0. Unaligned sequence ends carry no penalty in local alignment.'; }
        else if (!best) {
            reason = 'Take the maximum of 0 and the three move scores. Restart at 0 here; zero-score prefixes are left out of the traceback.';
        }
        else if (winners.length > 1) {
            reason = 'Take the maximum: ' + number(best) + '. ' + winners.length + ' moves tie for this score.';
        } else {
            reason = 'Take the maximum: ' + number(best) + '. ' + winners[0].label.slice(2) + ' gives the highest score.';
        }
        if (mScoring.gapModel === 'affine' && x && y) {
            reason += ' Gap candidates retain separate opening and extension histories.';
            var pathCell = mCurrentPath.filter(function(cell) { return cell.x === x && cell.y === y; })[0];
            if (mOptimalRank !== null && pathCell && pathCell.state &&
                !mEngine.equal(mEngine.cell(x, y).states[pathCell.state].score, best)) {
                reason += ' This optimal traceback uses the ' + stateLabel(pathCell.state) + ' score ' +
                    number(mEngine.cell(x, y).states[pathCell.state].score) + '.';
            }
        }
        $content.append($('<p class="tooltip-reason" />').text(reason));
        var targetDom = $('#' + x + '_' + y);
        var pos = targetDom.offset();
        targetDom.addClass('highlight-main');
        var box = targetDom[0].getBoundingClientRect();
        var avoid = {
            left: pos.left, right: pos.left + box.width,
            top: pos.top, bottom: pos.top + box.height
        };
        options.forEach(function(o) {
            var sourceBox = document.getElementById(o.fromX + '_' + o.fromY).getBoundingClientRect();
            avoid.left = Math.min(avoid.left, sourceBox.left + window.scrollX);
            avoid.right = Math.max(avoid.right, sourceBox.right + window.scrollX);
            avoid.top = Math.min(avoid.top, sourceBox.top + window.scrollY);
            avoid.bottom = Math.max(avoid.bottom, sourceBox.bottom + window.scrollY);
        });
        displayTooltip($content, pos.left + targetDom.outerWidth() + 10, pos.top, false, avoid);
    }

    function getCssClassesFromDirection(directions) {
        
        var cssClasses = "";

        if(!Array.isArray(directions)){
            return cssClasses;
        }

        cssClasses = directions.join(' ');

        return cssClasses;
        
    }

    function constructNRow(n) {

        var $table = $('#grid');
        var charIndex = parseInt(n, 10) - 1;
        var $tr = $('<tr />');
        var $th = null;

        if (charIndex >= 0) {
            $th = $('<th />')
                .addClass("seq-header")
                .addClass("side-header")
                .attr('id', 'side_seq_' + charIndex)
                .html(mSideSequence[charIndex]);
            $tr.append($th);
        } else {
            $th = $('<th />');
            $tr.append($th);
        }

        var $td = $('<td />')
            .text(AlignmentEngine.format(mCellMap[0 + "_" + n].winningScore))
            .attr('data-x', 0)
            .attr('data-y', n)
            .attr('id', 0 + "_" + n);
        $tr.append($td);

        for (var idx in mTopSequence) {
            idx = parseInt(idx, 10);
            var dataPointIndex = (idx + 1) + '_' + (charIndex + 1);
            
            var cssClasses = "";
            if(n > 0){
                cssClasses = getCssClassesFromDirection(mCellMap[(idx+1) + "_" + (charIndex+ 1)].direction);
            }

            $td = $('<td />')
                .addClass(cssClasses)
                .text(AlignmentEngine.format(mCellMap[dataPointIndex].winningScore))
                .attr('data-x', (idx + 1))
                .attr('data-y', (charIndex + 1))
                .attr('id', dataPointIndex);
            $tr.append($td);
        }

        $table.append($tr);
        mDomContainer.append($table);

    }


    function constructGrid() {

        clearAlignmentInspection();
        mDomResultContainer.empty();
        $('#alignmentScore').empty();
        $('#grid').remove();
        var $table = $('<table />').attr('id', 'grid');
        mDomGridTable = $table;
        mDomContainer.append($table);

        var $tr = $('<tr />');

        var $th = $('<th />');
        $tr.append($th);

        $th = $('<th />');
        $tr.append($th);

        for (var idx in mTopSequence) {
            $th = $('<th />');
            $th.attr('id', 'top_seq_' + idx);
            $th.addClass("seq-header");
            $th.addClass("top-header");
            $th.html(mTopSequence[idx]);
            $tr.append($th);
        }

        $table.append($tr);

        for (var i = 0; i < mSideSequence.length + 1; i++) {
            constructNRow(i);
        }

        $('#grid td').click(function() {
            if (mMovieActive) { return; }
            var self = $(this);
            onCellClicked(
                self,
                self.attr('data-x'),
                self.attr('data-y')
            );
        });

        $('#grid td').hover(function() {
            
            if (mIsCustomPathMode || mMovieActive) {
                return;
            }
            clearAlignmentInspection();
            
            var self = $(this);
            var x = self.attr('data-x');
            var y = self.attr('data-y');
            
            //console.log(           "#side_seq_" + (y -1));
            //console.log(           "#top_seq_" + (x -1));
            $("#side_seq_" + (y-1)).addClass('highlight');
            $("#top_seq_" + (x-1)).addClass('highlight');
            
            showTooltip(x, y);
        
        }, function() {
        
            $(".seq-header").removeClass('highlight');
            $('#grid td').removeClass('highlight');
            $('#grid td').removeClass('highlight-main');
            hideTooltip();
            
        });

        $('#grid th').hover(function() {
            
            var self = $(this);
            if(!self.hasClass("seq-header")){
                return;
            }
            clearAlignmentInspection();
            
            var pos = self.offset();
            var topMargin = self.hasClass("side-header")?self.height()/4:self.height() + 4;
            var leftMargin = self.hasClass("side-header")?self.width() + 4:0;
            var text = self.hasClass("included")?"Included In Alignment":"Not Included In Alignment";
            
            displayTooltip(text, pos.left + leftMargin, pos.top + topMargin );
            
        }, function() {
            hideTooltip();
        });


    }


    mSelf = {

        alignmentModel: function() { return mEngine; },

        beginMovie: function(plan) {
            this.startCustomPath();
            mMovieActive = true;
            mMovieRevealed = 0;
            mMovieCells = [];
            mDomGridTable.addClass('movie-grid instant');
            for (var i = 0; i < plan.fillCount; i++) {
                var cell = plan.cellAt(i), dom = document.getElementById(cell.x + '_' + cell.y);
                dom.textContent = '';
                dom.classList.add('movie-pending');
                dom.setAttribute('aria-label', 'Row ' + cell.y + ', column ' + cell.x + ': not filled yet');
                mMovieCells.push({ cell: cell, dom: dom });
            }
        },

        showMovieFrame: function(frame) {
            if (!mMovieActive) { return; }
            while (mMovieRevealed < frame.revealed) {
                var entry = mMovieCells[mMovieRevealed++];
                entry.dom.textContent = AlignmentEngine.format(entry.cell.score);
                entry.dom.classList.remove('movie-pending');
                entry.dom.removeAttribute('aria-label');
            }
            while (mMovieRevealed > frame.revealed) {
                entry = mMovieCells[--mMovieRevealed];
                entry.dom.textContent = '';
                entry.dom.classList.add('movie-pending');
                entry.dom.setAttribute('aria-label', 'Row ' + entry.cell.y + ', column ' + entry.cell.x + ': not filled yet');
            }
            this.restorePath({ custom: false, cells: frame.path, movie: true });
            mDomGridTable.find('.movie-current, .movie-source, .movie-header')
                .removeClass('movie-current movie-source movie-header');
            frame.sources.forEach(function(source) {
                document.getElementById(source.x + '_' + source.y).classList.add('movie-source');
            });
            var current = document.getElementById(frame.cell.x + '_' + frame.cell.y);
            current.classList.add('movie-current');
            $('#top_seq_' + (frame.cell.x - 1) + ', #side_seq_' + (frame.cell.y - 1)).addClass('movie-header');
            revealMatrixCell(current);
            if (frame.path.length > 1 && frame.phase !== 'Complete') {
                $('#alignmentScore').text('Aligned suffix = ' + AlignmentEngine.format(frame.suffixScore));
            }
            if (frame.phase === 'Complete' && !mEngine.count) { showEmptyAlignment(); }
        },

        endMovie: function() {
            if (!mMovieActive) { return; }
            mMovieActive = false;
            mMovieCells.forEach(function(entry) {
                entry.dom.textContent = AlignmentEngine.format(entry.cell.score);
                entry.dom.classList.remove('movie-pending', 'movie-current', 'movie-source');
                entry.dom.removeAttribute('aria-label');
            });
            mDomGridTable.removeClass('movie-grid').find('.movie-header').removeClass('movie-header');
            mMovieCells = [];
            mMovieRevealed = 0;
        },

        exportPath: function() {
            return {
                custom: mIsCustomPathMode,
                cells: mCurrentPath.map(function(cell) { return { x: cell.x, y: cell.y, state: cell.state }; })
            };
        },

        restorePath: function(state) {
            if (!mEngine || !state || !Array.isArray(state.cells)) { return; }
            clearAlignmentInspection();
            hideTooltip();
            mDomGridTable.removeClass('tracing').find('td')
                .removeClass('in-path is-last highlight highlight-main').removeAttr('data-index data-path-state');
            mDomGridTable.find('th').removeClass('highlight');
            mCurrentPath = [];
            mIsCustomPathMode = !!state.custom;
            mOptimalRank = state.custom || state.movie ? null : mEngine.rankPath(state.cells);
            if (mOptimalRank === null && !state.movie) { mIsCustomPathMode = true; }
            mIsBuildingOptimal = true;
            state.cells.forEach(function(cell) {
                if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y)) { return; }
                var dom = document.getElementById(cell.x + '_' + cell.y);
                if (dom) { onCellClicked($(dom), cell.x, cell.y, cell.state); }
            });
            mIsBuildingOptimal = false;
            onPathUpdate();
        },

        // Re-draw the current alignment while retaining its horizontal scroll position.
        refreshAlignment: function() {
            if (mDomResultContainer && mCurrentPath.length) {
                onPathUpdate();
            }
        },

        highlightOptimal: function() {
            if (mEngine) { this.showOptimal(0n); }
        },

        showOptimal: function(index) {
            if (!mEngine) { return; }
            this.restorePath({ custom: false, cells: mEngine.traceback(index) });
        },

        moveOptimal: function(offset) {
            if (!mEngine || mEngine.count < 2n) { return false; }
            var current = mOptimalRank === null ? 0n : mOptimalRank;
            this.showOptimal((current + BigInt(offset) + mEngine.count) % mEngine.count);
            return true;
        },

        optimalInfo: function() {
            return { count: mEngine ? mEngine.count.toString() : '0',
                index: mOptimalRank === null ? null : mOptimalRank.toString() };
        },

        reset: function() {
            this.endMovie();
            clearAlignmentInspection();
            hideTooltip();
            mCurrentPath = [];
            mEngine = null;
            mOptimalRank = null;
            updateAlternatives();
        },

        startCustomPath: function() {
            clearAlignmentInspection();
            mDomGridTable.removeClass('tracing').find('td')
                .removeClass('in-path is-last highlight highlight-main').removeAttr('data-index data-path-state');
            mDomGridTable.find('th').removeClass('highlight');
            hideTooltip();
            mCurrentPath = [];
            mOptimalRank = null;
            mIsCustomPathMode = true;
            onPathUpdate();
        },

        rebuildTable: function(domContainer, resultContainer, matchScore, mismatchScore, gapScore, seqSide, seqTop, scoringOptions) {

            this.endMovie();

            if (mIsFirstCall) {
                $(document).on('pointerdown', function(event) {
                    if (!$(event.target).closest('#alignment').length) { clearAlignmentInspection(); }
                });
                $(document).on('input', '.seq, .params', clearAlignmentInspection);
                $(window).on('resize', clearAlignmentInspection);
                $(window).mousemove(function(e) {
                    window.mouseXPos = e.pageX;
                    window.mouseYPos = e.pageY;
                });
                mIsFirstCall = false;
            }

            var settings = Object.assign({ match: matchScore, mismatch: mismatchScore, gap: gapScore }, scoringOptions || {});
            var engine = AlignmentEngine.create(seqSide, seqTop, settings);
            clearAlignmentInspection();
            mEngine = engine;
            mScoring = engine.config;
            mCurrentPath = [];
            mOptimalRank = null;
            mIsCustomPathMode = false;
            mDomContainer = domContainer;
            mDomResultContainer = resultContainer;
            mTopSequence = engine.top;
            mSideSequence = engine.side;
            mCellMap = {};
            engine.cells.forEach(function(row) {
                row.forEach(function(cell) {
                    mCellMap[cell.x + '_' + cell.y] = { winningScore: cell.score, direction: cell.directions };
                });
            });
            updateAlternatives();

            constructGrid();
        }

    };

    return mSelf;

}());
