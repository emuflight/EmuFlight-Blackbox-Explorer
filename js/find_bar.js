"use strict";

// Find-in-page bar. Ctrl/Cmd+F is caught in main.js (before-input-event), which sends
// 'show-find-bar'. Searching runs in the main process via webContents.findInPage.
(function () {
    const { ipcRenderer } = require('electron');

    let bar = null;
    let input = null;
    let countLabel = null;
    let matchCaseBtn = null;
    let searching = false; // true once a findInPage session has started (next calls use findNext)
    let matchCase = false;

    function build() {
        bar = document.createElement('div');
        bar.id = 'find-bar';
        bar.innerHTML =
            '<input type="text" spellcheck="false" placeholder="Find">' +
            '<span class="find-count"></span>' +
            '<button type="button" class="find-case" title="Match case">Aa</button>' +
            '<button type="button" class="find-prev" title="Previous (Shift+Enter)">&#9650;</button>' +
            '<button type="button" class="find-next" title="Next (Enter)">&#9660;</button>' +
            '<button type="button" class="find-close" title="Close (Esc)">&times;</button>';
        document.body.appendChild(bar);

        input = bar.querySelector('input');
        countLabel = bar.querySelector('.find-count');
        matchCaseBtn = bar.querySelector('.find-case');

        // Keep key and focus events away from the document-level graph key handlers
        // and from bootstrap modals' focus trap (which would pull focus back into the modal).
        ['keydown', 'keyup', 'keypress', 'focusin'].forEach(function (type) {
            bar.addEventListener(type, function (e) { e.stopPropagation(); });
        });

        input.addEventListener('input', function () {
            if (input.value === '') {
                stopSearch();
            } else {
                search(true, false);
            }
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                search(!e.shiftKey, true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                hide();
            }
        });
        bar.querySelector('.find-next').addEventListener('click', function () { search(true, true); });
        bar.querySelector('.find-prev').addEventListener('click', function () { search(false, true); });
        bar.querySelector('.find-close').addEventListener('click', hide);
        matchCaseBtn.addEventListener('click', function () {
            matchCase = !matchCase;
            matchCaseBtn.classList.toggle('active', matchCase);
            search(true, false);
            input.focus();
        });
    }

    // continuing=false starts a new session (findNext:false); true steps within the current one.
    function search(forward, continuing) {
        if (input.value === '') {
            return;
        }
        ipcRenderer.invoke('find-in-page', input.value, {
            forward: forward,
            findNext: continuing && searching,
            matchCase: matchCase,
        });
        searching = true;
    }

    function stopSearch() {
        if (searching) {
            ipcRenderer.invoke('stop-find-in-page');
            searching = false;
        }
        countLabel.textContent = '';
    }

    function show() {
        if (!bar) {
            build();
        }
        bar.classList.add('visible');
        input.focus();
        input.select();
        if (input.value !== '') {
            search(true, false);
        }
    }

    function hide() {
        if (!bar) {
            return;
        }
        bar.classList.remove('visible');
        stopSearch();
    }

    ipcRenderer.on('show-find-bar', show);
    ipcRenderer.on('found-in-page-result', function (event, result) {
        if (!bar || !searching || !result.final) {
            return;
        }
        countLabel.textContent = result.matches === 0 ? '0 of 0' : result.active + ' of ' + result.matches;
    });
})();
